const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const databasePath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'database');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');

const { createTicket, closeTicket, getUserOpenTicket, getOpenTickets } = require(databasePath);
const { getConfig } = require(configPath);

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Cria a mensagem com botão para abrir tickets.')
    .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar o painel (Padrão é o atual)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

async function handleTicketSetup(interaction) {
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const embed = new EmbedBuilder()
    .setTitle('🎫 Sistema de Tickets')
    .setDescription('Precisas de ajuda? Clica no botão abaixo para abrir um ticket privado com a equipa de suporte!\n\n📌 **Regras:**\n• Apenas 1 ticket aberto por vez\n• Descreve o teu problema claramente\n• Não abuses do sistema de tickets')
    .setColor('#5865F2')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('📩 Abrir Ticket')
      .setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: `✅ Painel de tickets criado em ${channel}!`, ephemeral: true });
}

async function handleTicketOpen(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;

  const existing = getUserOpenTicket(guild.id, user.id);
  if (existing) {
    return interaction.reply({ content: `❌ Já tens um ticket aberto: <#${existing.channel_id}>`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const config = getConfig();
  const ticketConfig = config.tickets || {};
  const supportRoleId = ticketConfig.supportRoleId || null;

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory]
    },
    {
      id: interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
    }
  ];

  if (supportRoleId) {
    permissionOverwrites.push({
      id: supportRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  const ticketChannel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    parent: ticketConfig.categoryId || null,
    permissionOverwrites,
    reason: `Ticket aberto por ${user.tag}`
  });

  createTicket(guild.id, ticketChannel.id, user.id);

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`🎫 Ticket de ${user.tag}`)
    .setDescription(`Olá ${user}! A equipa de suporte irá responder em breve.\n\nDescreve o teu problema ou questão aqui.\n\nClica em **🔒 Fechar Ticket** quando estiver resolvido.`)
    .setColor('#5865F2')
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('🔒 Fechar Ticket')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('📜 Guardar Transcrição')
      .setStyle(ButtonStyle.Secondary)
  );

  await ticketChannel.send({ content: `${user} ${supportRoleId ? `<@&${supportRoleId}>` : ''}`, embeds: [welcomeEmbed], components: [closeRow] });

  await interaction.editReply({ content: `✅ Ticket criado: ${ticketChannel}` });
}

async function handleTicketClose(interaction) {
  const channel = interaction.channel;

  const transcript = await generateTranscript(channel);
  closeTicket(channel.id);

  const embed = new EmbedBuilder()
    .setTitle('🔒 Ticket Fechado')
    .setDescription(`Ticket fechado por ${interaction.user}.\n\n📊 **${transcript.messageCount}** mensagens no total.`)
    .setColor('#ED4245')
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  const config = getConfig();
  const ticketConfig = config.tickets || {};
  if (ticketConfig.logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(ticketConfig.logChannelId);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle(`📜 Transcrição: #${channel.name}`)
        .setDescription(transcript.text.substring(0, 4000))
        .setColor('#5865F2')
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }
  }

  setTimeout(async () => {
    try {
      await channel.delete('Ticket fechado');
    } catch (err) {
      console.error('[TICKETS] Erro ao apagar canal:', err.message);
    }
  }, 5000);
}

async function handleTicketTranscript(interaction) {
  const transcript = await generateTranscript(interaction.channel);

  const embed = new EmbedBuilder()
    .setTitle(`📜 Transcrição: #${interaction.channel.name}`)
    .setDescription(transcript.text.substring(0, 4000))
    .setColor('#5865F2')
    .setFooter({ text: `${transcript.messageCount} mensagens` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function generateTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = [...messages.values()].reverse();

    let text = `=== Transcrição de #${channel.name} ===\n\n`;
    sorted.forEach(msg => {
      const time = new Date(msg.createdTimestamp).toLocaleString('pt-PT');
      text += `[${time}] ${msg.author.tag}: ${msg.content || '[Embed/Anexo]'}\n`;
    });

    return { text, messageCount: sorted.length };
  } catch {
    return { text: 'Não foi possível gerar transcrição.', messageCount: 0 };
  }
}

const events = {
  interactionCreate: async (client, interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
      await handleTicketSetup(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId === 'ticket_open') await handleTicketOpen(interaction);
      if (interaction.customId === 'ticket_close') await handleTicketClose(interaction);
      if (interaction.customId === 'ticket_transcript') await handleTicketTranscript(interaction);
    }
  }
};

module.exports = {
  commands,
  events
};
