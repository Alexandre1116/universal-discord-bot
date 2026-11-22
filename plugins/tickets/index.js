const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');
const { createTicket, closeTicket, getUserOpenTicket, getOpenTickets } = require('../../src/utils/database');

function init(client) {
  console.log('[TICKETS] Plugin inicializado.');
}

// Envia a transcrição do ticket para o canal de logs configurado.
// Devolve true (enviado), false (configurado mas falhou) ou null (não configurado).
async function sendTranscript(guild, channel, ticketsConfig, closedBy) {
  if (!ticketsConfig.logChannelId) return null;

  const logChannel = guild.channels.cache.get(ticketsConfig.logChannelId) ||
    await guild.channels.fetch(ticketsConfig.logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) {
    console.error('[TICKETS] Canal de logs configurado não existe/não é de texto; transcrição não enviada.');
    return false;
  }

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const lines = [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(m => `[${m.createdAt.toISOString()}] ${m.author?.tag ?? 'desconhecido'}: ${m.content || '*sem texto*'}`);

    const text = lines.join('\n') || 'Ticket sem mensagens.';
    const safeName = (channel.name || 'ticket').replace(/[^a-z0-9-]/gi, '_');
    const attachment = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${safeName}-transcript.txt` });

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎫 Ticket Fechado')
      .setDescription(`Transcrição de **#${channel.name}** (${lines.length} mensagens${lines.length >= 100 ? ', apenas as últimas 100' : ''}).`)
      .setFooter({ text: `Fechado por ${closedBy?.tag ?? 'desconhecido'}` })
      .setTimestamp();

    await logChannel.send({ embeds: [embed], files: [attachment] });
    return true;
  } catch (err) {
    console.error('[TICKETS] Erro ao enviar transcrição:', err.message);
    return false;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Cria um painel de tickets neste canal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Fecha o ticket atual.')
];

const events = {
  interactionCreate: async (client, interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎫 Sistema de Tickets')
        .setDescription('Precisas de ajuda? Clica no botão abaixo para abrir um ticket privado com a equipa de suporte.')
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_open')
            .setLabel('Abrir Ticket')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎫')
        );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-close') {
      const config = getConfig();
      const ticketsConfig = config.tickets || {};
      const channelName = interaction.channel.name || '';

      if (!channelName.startsWith('ticket-')) {
        return interaction.reply({ content: 'Este comando só pode ser usado num canal de ticket.', ephemeral: true });
      }

      // Só o autor do ticket ou a equipa de suporte o pode fechar
      const ticket = getOpenTickets(interaction.guild.id).find(t => t.channel_id === interaction.channel.id);
      const isSupport = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        (ticketsConfig.supportRoleId && interaction.member.roles.cache.has(ticketsConfig.supportRoleId));
      if (ticket && ticket.user_id !== interaction.user.id && !isSupport) {
        return interaction.reply({ content: 'Apenas quem abriu o ticket (ou a equipa de suporte) o pode fechar.', ephemeral: true });
      }

      try {
        closeTicket(interaction.channel.id);
        await interaction.reply('🔒 A fechar este ticket em 5 segundos...');

        const transcript = await sendTranscript(interaction.guild, interaction.channel, ticketsConfig, interaction.user);

        // Se a transcrição estava configurada e falhou, NÃO apagamos o canal:
        // era a única cópia do conteúdo do ticket.
        if (transcript === false) {
          await interaction.followUp({
            content: '⚠️ Não consegui enviar a transcrição para o canal de logs. O canal do ticket **não foi apagado** para não perder o conteúdo — corrige o canal de logs e volta a tentar.',
            ephemeral: true
          });
          return;
        }

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (err) {
            console.error('[TICKETS] Erro ao apagar canal de ticket:', err.message);
          }
        }, 5000);
      } catch (err) {
        console.error('[TICKETS] Erro ao fechar ticket:', err.message);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Erro ao fechar ticket.', ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: 'Erro ao fechar ticket.', ephemeral: true }).catch(() => {});
        }
      }
    }

    if (interaction.isButton() && interaction.customId === 'ticket_open') {
      const config = getConfig();
      const ticketsConfig = config.tickets || {};

      const existing = getUserOpenTicket(interaction.guild.id, interaction.user.id);
      if (existing) {
        return interaction.reply({ content: 'Já tens um ticket aberto. Fecha-o antes de abrir outro.', ephemeral: true });
      }

      try {
        const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
        const parentId = ticketsConfig.categoryId || null;

        const ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: parentId,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
          ]
        });

        if (ticketsConfig.supportRoleId) {
          await ticketChannel.permissionOverwrites.create(ticketsConfig.supportRoleId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        }

        createTicket(interaction.guild.id, ticketChannel.id, interaction.user.id);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎫 Ticket Aberto')
          .setDescription(`Olá <@${interaction.user.id}>! Descreve o teu problema e a equipa de suporte responderá em breve.\n\nPara fechar o ticket, usa \`/ticket-close\`.`)
          .setTimestamp();

        await ticketChannel.send({ content: `<@${interaction.user.id}> ${ticketsConfig.supportRoleId ? `<@&${ticketsConfig.supportRoleId}>` : ''}`, embeds: [embed] });
        await interaction.reply({ content: `Ticket criado: ${ticketChannel}`, ephemeral: true });
      } catch (err) {
        console.error('[TICKETS] Erro ao criar ticket:', err.message);
        await interaction.reply({ content: 'Erro ao criar ticket. Verifica as permissões do bot.', ephemeral: true });
      }
    }
  }
};

module.exports = { init, commands, events };
