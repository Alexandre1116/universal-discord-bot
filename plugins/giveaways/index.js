const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createGiveaway, enterGiveaway, getGiveawayEntries, getActiveGiveaways, endGiveaway, getGiveawayByMessage } = require('../../src/utils/database');

function init(client) {
  console.log('[GIVEAWAYS] Plugin inicializado.');

  checkActiveGiveaways(client);
  setInterval(() => checkActiveGiveaways(client), 15000);
}

// As datas podem vir em ISO 8601 (com 'Z') ou no formato de texto do SQLite
// ('YYYY-MM-DD HH:MM:SS', sem fuso). Juntar sempre 'Z' rebentava o parse (NaN),
// por isso só acrescentamos o fuso quando ele não existe.
function toDate(value) {
  if (!value) return null;
  let str = String(value).trim();
  if (!/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) str += 'Z';
  str = str.replace(' ', 'T');
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function checkActiveGiveaways(client) {
  const active = getActiveGiveaways();
  for (const gw of active) {
    const endsAt = toDate(gw.ends_at);
    if (!endsAt) {
      console.warn(`[GIVEAWAYS] Data de término inválida no sorteio ${gw.id}: ${gw.ends_at}`);
      endGiveaway(gw.id);
      continue;
    }
    if (Date.now() >= endsAt.getTime()) {
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
      if (channel && channel.isTextBased()) {
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
    if (!channel || !channel.isTextBased()) {
      endGiveaway(gw.id);
      return;
    }

    try {
      const msg = await channel.messages.fetch(gw.message_id).catch(() => null);
      if (msg) {
        const base = msg.embeds[0] ? EmbedBuilder.from(msg.embeds[0]) : new EmbedBuilder();
        const embed = base
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
      if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Os sorteios só funcionam em servidores.', ephemeral: true });
      }

      const prize = interaction.options.getString('prize');
      const winnersCount = interaction.options.getInteger('winners') || 1;
      const durationMin = interaction.options.getInteger('duration');
      const endsAt = new Date(Date.now() + durationMin * 60000);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 Sorteio!')
        .setDescription(`**Prémio:** ${prize}\n**Vencedores:** ${winnersCount}\n**Termina:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>\n\nClica no botão para participar!`)
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

      createGiveaway(interaction.guild.id, interaction.channel.id, msg.id, prize, winnersCount, interaction.user.id, endsAt.toISOString());
      console.log(`[GIVEAWAYS] Sorteio criado: ${prize} por ${interaction.user.tag}`);
    }

    if (interaction.isButton() && interaction.customId === 'giveaway_enter') {
      const giveaway = getGiveawayByMessage(interaction.message.id);
      if (!giveaway || giveaway.ended) {
        return interaction.reply({ content: 'Este sorteio já não está ativo.', ephemeral: true });
      }

      const endsAt = toDate(giveaway.ends_at);
      if (!endsAt || endsAt.getTime() < Date.now()) {
        return interaction.reply({ content: 'Este sorteio já terminou.', ephemeral: true });
      }

      const entered = enterGiveaway(giveaway.id, interaction.user.id);
      const entries = getGiveawayEntries(giveaway.id).length;
      if (entered) {
        await interaction.reply({ content: `✅ Estás inscrito no sorteio! (${entries} participante(s))`, ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ Já participas neste sorteio.', ephemeral: true });
      }
    }
  }
};

module.exports = { init, commands, events };
