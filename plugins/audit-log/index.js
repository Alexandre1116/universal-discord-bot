const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getConfig } = require('../../src/utils/config');

function init(client) {
  console.log('[AUDIT LOG] Plugin inicializado.');
}

async function getLogChannel(guild) {
  const config = getConfig();
  const auditConfig = config.auditLog || {};
  if (!auditConfig.enabled || !auditConfig.channelId) return null;
  return guild.channels.cache.get(auditConfig.channelId) || await guild.channels.fetch(auditConfig.channelId).catch(() => null);
}

const events = {
  messageDelete: async (client, message) => {
    if (message.author?.bot) return;
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.messageDelete) return;

    const channel = await getLogChannel(message.guild);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('🗑️ Mensagem Apagada')
      .addFields(
        { name: 'Autor', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }
      )
      .setDescription(message.content ? `**Conteúdo:** ${message.content.slice(0, 1024)}` : '*Sem conteúdo (possivelmente embed/imagem)*')
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },

  messageUpdate: async (client, oldMessage, newMessage) => {
    if (oldMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.messageEdit) return;

    const channel = await getLogChannel(oldMessage.guild);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('✏️ Mensagem Editada')
      .addFields(
        { name: 'Autor', value: `<@${oldMessage.author.id}>`, inline: true },
        { name: 'Canal', value: `<#${oldMessage.channel.id}>`, inline: true },
        { name: 'Antes', value: oldMessage.content?.slice(0, 1024) || '*Vazio*' },
        { name: 'Depois', value: newMessage.content?.slice(0, 1024) || '*Vazio*' }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },

  guildBanAdd: async (client, ban) => {
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.bans) return;

    const channel = await getLogChannel(ban.guild);
    if (!channel) return;

    let moderator = 'Desconhecido';
    try {
      const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
      const entry = logs.entries.first();
      if (entry) moderator = `<@${entry.executor.id}>`;
    } catch {}

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('🔨 Membro Banido')
      .addFields(
        { name: 'Membro', value: ban.user ? `<@${ban.user.id}> (${ban.user.tag})` : 'Desconhecido', inline: true },
        { name: 'Moderador', value: moderator, inline: true },
        { name: 'Razão', value: ban.reason || 'Sem razão especificada' }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },

  guildBanRemove: async (client, ban) => {
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.bans) return;

    const channel = await getLogChannel(ban.guild);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🔓 Membro Desbanido')
      .addFields(
        { name: 'Membro', value: ban.user ? `<@${ban.user.id}> (${ban.user.tag})` : 'Desconhecido', inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },

  voiceStateUpdate: async (client, oldState, newState) => {
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.voiceJoinLeave) return;

    const channel = await getLogChannel(newState.guild);
    if (!channel) return;

    const member = newState.member;
    if (!member) return;

    let action = null;
    if (!oldState.channelId && newState.channelId) {
      action = 'Entrou';
    } else if (oldState.channelId && !newState.channelId) {
      action = 'Saiu';
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      action = 'Mudou';
    }

    if (!action) return;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🔊 Atividade de Voz')
      .addFields(
        { name: 'Membro', value: `<@${member.id}>`, inline: true },
        { name: 'Ação', value: action, inline: true }
      );

    if (action === 'Mudou') {
      embed.addFields(
        { name: 'De', value: `<#${oldState.channelId}>`, inline: true },
        { name: 'Para', value: `<#${newState.channelId}>`, inline: true }
      );
    } else if (action === 'Entrou') {
      embed.addFields({ name: 'Canal', value: `<#${newState.channelId}>`, inline: true });
    } else {
      embed.addFields({ name: 'Canal', value: `<#${oldState.channelId}>`, inline: true });
    }

    embed.setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
};

module.exports = { init, events };
