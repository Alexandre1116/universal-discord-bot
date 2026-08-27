const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createGiveaway, enterGiveaway, getGiveawayEntries, getActiveGiveaways, endGiveaway, getGiveawayByMessage } = require('../../utils/database');

function init(client) {
  console.log('[GIVEAWAYS] Plugin inicializado.');

  checkActiveGiveaways(client);
  setInterval(() => checkActiveGiveaways(client), 15000);
}

async function checkActiveGiveaways(client) {
  const active = getActiveGiveaways();
  for (const gw of active) {
    const endsAt = new Date(gw.ends_at + 'Z').getTime();
    if (Date.now() >= endsAt) {
      await finishGiveaway(client, gw);
    }
  }
}

async function finishGiveaway(client, gw) {
  try {
    const entries = getGiveawayEntries(gw.id);
    const winners = [];
    const participantIds = entries.map(e => e.user_id);

    if (participantIds.length === 0) {
      const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
      if (channel) {
        await channel.send({ content: `🎁 O sorteio de **${gw.prize}** terminou sem participantes.` });
      }
      endGiveaway(gw.id);
      return;
    }

    const winnerCount = Math.min(gw.winners_count || 1, participantIds.length);
    for (let i = 0; i < winnerCount; i++) {
      const idx = Math.floor(Math.random() * participantIds.length);
      winners.push(participantIds.splice(idx, 1)[0]);
    }

    const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
    if (!channel) {
      endGiveaway(gw.id);
      return;
    }

    try {
      const msg = await channel.messages.fetch(gw.message_id).catch(() => null);
      if (msg) {
        const embed = EmbedBuilder.from(msg.embeds[0] || new EmbedBuilder())
          .setColor('#2D7DFF')
          .setDescription(`Sorteio terminado! 🎉\n\n**Vencedor(es):** ${winners.map(w => `<@${w}>`).join(', ')}\n**Prémio:** ${gw.prize}`);
        await msg.edit({ embeds: [embed], components: [] });
      }
    } catch (e) {
      console.error('[GIVEAWAYS] Erro ao editar mensagem do sorteio:', e.message);
    }

    await channel.send({ content: `🎉 ${winners.map(w => `<@${w}>`).join(', ')} ganharam o sorteio de **${gw.prize}**! Parabéns!` });
    endGiveaway(gw.id);
    console.log(`[GIVEAWAYS] Sorteio ${gw.id} terminado. Vencedores: ${winners.join(', ')}`);
  } catch (err) {
    console.error('[GIVEAWAYS] Erro ao terminar sorteio:', err.message);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Inicia um novo sorteio.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('prize').setDescription('Prémio do sorteio').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Número de vencedores').setMinValue(1).setMaxValue(20))
    .addIntegerOption(o => o.setName('duration').setDescription('Duração em minutos').setMinValue(1).setRequired(true))
];

const events = {
  interactionCreate: async (client, interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'giveaway') {
      const prize = interaction.options.getString('prize');
      const winnersCount = interaction.options.getInteger('winners') || 1;
      const durationMin = interaction.options.getInteger('duration');
      const endsAt = new Date(Date.now() + durationMin * 60000).toISOString();

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 Sorteio!')
        .setDescription(`**Prémio:** ${prize}\n**Vencedores:** ${winnersCount}\n**Termina:** <t:${Math.floor(new Date(endsAt + 'Z').getTime() / 1000)}:R>\n\nClica no botão para participar!`)
        .setFooter({ text: `Organizado por ${interaction.user.tag}` })
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('giveaway_enter')
            .setLabel('Participar')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎉')
        );

      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

      createGiveaway(interaction.guild.id, interaction.channel.id, msg.id, prize, winnersCount, interaction.user.id, endsAt);
      console.log(`[GIVEAWAYS] Sorteio criado: ${prize} por ${interaction.user.tag}`);
    }

    if (interaction.isButton() && interaction.customId === 'giveaway_enter') {
      const giveaway = getGiveawayByMessage(interaction.message.id);
      if (!giveaway) {
        return interaction.reply({ content: 'Este sorteio já não está ativo.', ephemeral: true });
      }

      if (new Date(giveaway.ends_at + 'Z').getTime() < Date.now()) {
        return interaction.reply({ content: 'Este sorteio já terminou.', ephemeral: true });
      }

      const entered = enterGiveaway(giveaway.id, interaction.user.id);
      if (entered) {
        await interaction.reply({ content: '✅ Estás inscrito no sorteio!', ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ Já participas neste sorteio.', ephemeral: true });
      }
    }
  }
};

module.exports = { init, commands, events };
