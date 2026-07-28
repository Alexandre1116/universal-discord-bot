const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const ms = require('ms');
const path = require('path');

const databasePath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'database');
const { createGiveaway, getGiveawayByMessage, getGiveawayEntries, endGiveaway, enterGiveaway } = require(databasePath);

const commands = [
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Comandos de sorteios (Giveaways)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => 
      sub
        .setName('start')
        .setDescription('Inicia um novo sorteio')
        .addStringOption(o => o.setName('premio').setDescription('O que vais sortear?').setRequired(true))
        .addStringOption(o => o.setName('duração').setDescription('Ex: 1m, 1h, 1d, 7d').setRequired(true))
        .addIntegerOption(o => o.setName('vencedores').setDescription('Número de vencedores (Padrão 1)'))
        .addChannelOption(o => o.setName('canal').setDescription('Canal onde enviar o sorteio (Padrão é o atual)'))
    )
    .addSubcommand(sub => 
      sub
        .setName('end')
        .setDescription('Termina um sorteio antecipadamente')
        .addStringOption(o => o.setName('mensagem_id').setDescription('ID da mensagem do sorteio').setRequired(true))
    )
    .addSubcommand(sub => 
      sub
        .setName('reroll')
        .setDescription('Sorteia um novo vencedor para um sorteio terminado')
        .addStringOption(o => o.setName('mensagem_id').setDescription('ID da mensagem do sorteio').setRequired(true))
    )
];

async function handleGiveawayStart(interaction) {
  const prize = interaction.options.getString('premio');
  const durationStr = interaction.options.getString('duração');
  const winnersCount = interaction.options.getInteger('vencedores') || 1;
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const duration = ms(durationStr);
  if (!duration || duration < 10000) {
    return interaction.reply({ content: '❌ Duração inválida. Usa: 1m, 1h, 1d, 7d.', ephemeral: true });
  }

  const endsAt = new Date(Date.now() + duration).toISOString();

  const embed = new EmbedBuilder()
    .setTitle('🎉 SORTEIO!')
    .setDescription(`**Prémio:** ${prize}\n\n**Vencedores:** ${winnersCount}\n**Termina:** <t:${Math.floor(Date.now() / 1000 + duration / 1000)}:R>\n**Organizado por:** ${interaction.user}\n\nClica no botão 🎉 abaixo para participar!`)
    .setColor('#57F287')
    .setFooter({ text: `Termina em ${durationStr}` })
    .setTimestamp(new Date(Date.now() + duration));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway_enter')
      .setLabel('🎉 Participar')
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });

  createGiveaway(interaction.guildId, channel.id, msg.id, prize, winnersCount, interaction.user.id, endsAt);

  await interaction.reply({ content: `✅ Sorteio de **${prize}** criado em ${channel}! Termina <t:${Math.floor(Date.now() / 1000 + duration / 1000)}:R>.`, ephemeral: true });
}

async function handleGiveawayEnd(interaction) {
  const messageId = interaction.options.getString('mensagem_id');
  const giveaway = getGiveawayByMessage(messageId);

  if (!giveaway) return interaction.reply({ content: '❌ Sorteio não encontrado com esse ID de mensagem.', ephemeral: true });
  if (giveaway.ended) return interaction.reply({ content: '❌ Este sorteio já terminou.', ephemeral: true });

  await finishGiveaway(interaction.client, giveaway);
  await interaction.reply({ content: '✅ Sorteio terminado! Vencedores anunciados.', ephemeral: true });
}

async function handleGiveawayReroll(interaction) {
  const messageId = interaction.options.getString('mensagem_id');
  const giveaway = getGiveawayByMessage(messageId);

  if (!giveaway) return interaction.reply({ content: '❌ Sorteio não encontrado com esse ID de mensagem.', ephemeral: true });

  const entries = getGiveawayEntries(giveaway.id);
  if (entries.length === 0) return interaction.reply({ content: '❌ Não houve participantes neste sorteio.', ephemeral: true });

  const winners = selectWinners(entries, giveaway.winners_count);
  const winnersText = winners.map(w => `<@${w}>`).join(', ');

  const channel = interaction.client.channels.cache.get(giveaway.channel_id);
  if (channel) {
    await channel.send({ content: `🎉 **Reroll do sorteio!** Novo(s) vencedor(es) de **${giveaway.prize}**: ${winnersText}! Parabéns! 🎊` });
  }

  await interaction.reply({ content: `✅ Reroll realizado! Novo(s) vencedor(es): ${winnersText}`, ephemeral: true });
}

async function finishGiveaway(client, giveaway) {
  endGiveaway(giveaway.id);

  const entries = getGiveawayEntries(giveaway.id);
  const channel = client.channels.cache.get(giveaway.channel_id);

  if (!channel) return;

  try {
    const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);

    if (entries.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🎉 SORTEIO TERMINADO')
        .setDescription(`**Prémio:** ${giveaway.prize}\n\n❌ Nenhum participante. Sem vencedores.`)
        .setColor('#ED4245')
        .setTimestamp();

      if (msg) await msg.edit({ embeds: [embed], components: [] });
      await channel.send({ content: `😢 Ninguém participou no sorteio de **${giveaway.prize}**.` });
      return;
    }

    const winners = selectWinners(entries, giveaway.winners_count);
    const winnersText = winners.map(w => `<@${w}>`).join(', ');

    const embed = new EmbedBuilder()
      .setTitle('🎉 SORTEIO TERMINADO')
      .setDescription(`**Prémio:** ${giveaway.prize}\n\n🏆 **Vencedor(es):** ${winnersText}\n\n**Participantes:** ${entries.length}\n**Organizado por:** <@${giveaway.host_id}>`)
      .setColor('#FFD700')
      .setTimestamp();

    if (msg) await msg.edit({ embeds: [embed], components: [] });
    await channel.send({ content: `🎊 Parabéns ${winnersText}! Ganhas(m) **${giveaway.prize}**! 🎉` });
  } catch (err) {
    console.error('[GIVEAWAY] Erro ao terminar sorteio:', err);
  }
}

function selectWinners(entries, count) {
  const shuffled = [...entries].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, entries.length)).map(e => e.user_id);
}

async function handleGiveawayButton(interaction) {
  const giveaway = getGiveawayByMessage(interaction.message.id);

  if (!giveaway) return interaction.reply({ content: '❌ Sorteio não encontrado.', ephemeral: true });
  if (giveaway.ended) return interaction.reply({ content: '❌ Este sorteio já terminou.', ephemeral: true });

  const success = enterGiveaway(giveaway.id, interaction.user.id);
  if (success) {
    const totalEntries = getGiveawayEntries(giveaway.id).length;
    await interaction.reply({ content: `✅ Estás a participar no sorteio de **${giveaway.prize}**! (${totalEntries} participantes no total)`, ephemeral: true });
  } else {
    await interaction.reply({ content: '⚠️ Já estás a participar neste sorteio!', ephemeral: true });
  }
}

const events = {
  interactionCreate: async (client, interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'giveaway') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'start') await handleGiveawayStart(interaction);
      if (sub === 'end') await handleGiveawayEnd(interaction);
      if (sub === 'reroll') await handleGiveawayReroll(interaction);
    } else if (interaction.isButton() && interaction.customId === 'giveaway_enter') {
      await handleGiveawayButton(interaction);
    }
  }
};

module.exports = {
  commands,
  events,
  // export for cron tasks if needed
  finishGiveaway
};
