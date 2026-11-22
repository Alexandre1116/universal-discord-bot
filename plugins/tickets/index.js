const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');
const { createTicket, closeTicket, getUserOpenTicket, getOpenTickets } = require('../../src/utils/database');

function init(client) {
  console.log('[TICKETS] Plugin inicializado.');
}

// Recolhe as mensagens do ticket (até ~1000, paginadas) e envia a transcrição
// para o canal de logs configurado.
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
    // Paginação: o fetch do Discord devolve no máximo 100 por pedido
    const collected = new Map();
    let before = undefined;
    for (let page = 0; page < 10; page++) {
      const batch = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
      if (batch.size === 0) break;
      for (const m of batch.values()) collected.set(m.id, m);
      if (batch.size < 100) break;
      before = batch.last().id;
    }

    const lines = [...collected.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(m => {
        const attachments = m.attachments && m.attachments.size
          ? ` [anexos: ${[...m.attachments.values()].map(a => a.name).join(', ')}]`
          : '';
        return `[${m.createdAt.toISOString()}] ${m.author?.tag ?? 'desconhecido'}: ${m.content || '*sem texto*'}${attachments}`;
      });

    const text = lines.join('\n') || 'Ticket sem mensagens.';
    const safeName = (channel.name || 'ticket').replace(/[^a-z0-9-]/gi, '_');
    const attachment = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${safeName}-transcript.txt` });

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎫 Ticket Fechado')
      .setDescription(`Transcrição de **#${channel.name}** (${lines.length} mensagens${collected.size >= 1000 ? ', limite de 1000 atingido' : ''}).`)
      .setFooter({ text: `Fechado por ${closedBy?.tag ?? 'desconhecido'}` })
      .setTimestamp();

    await logChannel.send({ embeds: [embed], files: [attachment] });
    return true;
  } catch (err) {
    console.error('[TICKETS] Erro ao enviar transcrição:', err.message);
    return false;
  }
}

// Evita dois fechos do mesmo canal em simultâneo
const closing = new Set();

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

      const channelId = interaction.channel.id;
      if (closing.has(channelId)) {
        return interaction.reply({ content: 'Este ticket já está a ser fechado.', ephemeral: true });
      }
      closing.add(channelId);

      // Só o autor do ticket ou a equipa de suporte o pode fechar. Sem registo
      // aberto na BD, só a equipa de suporte — caso contrário qualquer membro
      // conseguia apagar um canal chamado "ticket-*".
      const ticket = getOpenTickets(interaction.guild.id).find(t => t.channel_id === channelId);
      const isSupport = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        (ticketsConfig.supportRoleId && interaction.member.roles.cache.has(ticketsConfig.supportRoleId));

      if (!ticket && !isSupport) {
        closing.delete(channelId);
        return interaction.reply({ content: 'Este canal não corresponde a um ticket aberto; apenas a equipa de suporte o pode fechar.', ephemeral: true });
      }
      if (ticket && ticket.user_id !== interaction.user.id && !isSupport) {
        closing.delete(channelId);
        return interaction.reply({ content: 'Apenas quem abriu o ticket (ou a equipa de suporte) o pode fechar.', ephemeral: true });
      }

      // A trava é libertada no fim, exceto quando o fecho ficou ao cuidado do
      // setTimeout (durante os 5 s um segundo /ticket-close não pode entrar)
      let closingHeldByTimeout = false;

      try {
        await interaction.deferReply();

        // 1) Transcrição primeiro: se falhar, nada é alterado (canal e registo
        // ficam abertos para uma nova tentativa). A resposta pública só sai depois
        // de a transcrição estar garantida — "a fechar em 5 segundos" antes disso
        // ficava a mentir quando a transcrição falhava.
        const transcript = await sendTranscript(interaction.guild, interaction.channel, ticketsConfig, interaction.user);
        if (transcript === false) {
          await interaction.editReply({
            content: '⚠️ Não consegui enviar a transcrição para o canal de logs. O ticket **não foi fechado** para não perder o conteúdo — corrige o canal de logs e volta a tentar.'
          });
          return;
        }

        // 2) Só depois marca fechado na BD
        if (!closeTicket(channelId)) {
          await interaction.editReply({
            content: '⚠️ A transcrição foi enviada, mas a base de dados não registou o fecho. O canal **não foi apagado** — volta a tentar.'
          });
          return;
        }

        closingHeldByTimeout = true;
        await interaction.editReply('🔒 A fechar este ticket em 5 segundos...');

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (err) {
            console.error('[TICKETS] Erro ao apagar canal de ticket:', err.message);
          } finally {
            closing.delete(channelId);
          }
        }, 5000);
      } catch (err) {
        console.error('[TICKETS] Erro ao fechar ticket:', err.message);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Erro ao fechar ticket.', ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: 'Erro ao fechar ticket.', ephemeral: true }).catch(() => {});
        }
      } finally {
        if (!closingHeldByTimeout) closing.delete(channelId);
      }
    }

    if (interaction.isButton() && interaction.customId === 'ticket_open') {
      const config = getConfig();
      const ticketsConfig = config.tickets || {};

      const existing = getUserOpenTicket(interaction.guild.id, interaction.user.id);
      if (existing) {
        // Se o canal foi apagado à mão, o registo ficava "open" para sempre e o
        // utilizador nunca mais conseguia abrir um ticket
        const existingChannel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
        if (!existingChannel) {
          closeTicket(existing.channel_id);
        } else {
          return interaction.reply({ content: 'Já tens um ticket aberto. Fecha-o antes de abrir outro.', ephemeral: true });
        }
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
