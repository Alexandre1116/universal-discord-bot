const { EmbedBuilder } = require('discord.js');
const path = require('path');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');
const { getConfig } = require(configPath);

const events = {
  voiceStateUpdate: async (client, oldState, newState) => {
    try {
      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId || !auditConfig.voiceJoinLeave) return;

      const auditChannel = newState.guild.channels.cache.get(auditConfig.channelId);
      if (!auditChannel || !auditChannel.isTextBased()) return;

      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;

      if (newState.channelId && !oldState.channelId) {
        const embed = new EmbedBuilder()
          .setTitle('🔊 Membro Entrou em Canal de Voz')
          .setColor('#57F287')
          .addFields(
            { name: '👤 Membro', value: `${member.user.tag}`, inline: true },
            { name: '🔊 Canal', value: `<#${newState.channelId}>`, inline: true }
          )
          .setTimestamp();
        await auditChannel.send({ embeds: [embed] }).catch(() => {});
      } else if (oldState.channelId && !newState.channelId) {
        const embed = new EmbedBuilder()
          .setTitle('🔇 Membro Saiu de Canal de Voz')
          .setColor('#ED4245')
          .addFields(
            { name: '👤 Membro', value: `${member.user.tag}`, inline: true },
            { name: '🔊 Canal', value: `<#${oldState.channelId}>`, inline: true }
          )
          .setTimestamp();
        await auditChannel.send({ embeds: [embed] }).catch(() => {});
      } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const embed = new EmbedBuilder()
          .setTitle('🔀 Membro Mudou de Canal de Voz')
          .setColor('#5865F2')
          .addFields(
            { name: '👤 Membro', value: `${member.user.tag}`, inline: true },
            { name: '⬅️ De', value: `<#${oldState.channelId}>`, inline: true },
            { name: '➡️ Para', value: `<#${newState.channelId}>`, inline: true }
          )
          .setTimestamp();
        await auditChannel.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (error) {
      console.error('[AUDIT LOG] Erro no evento voiceStateUpdate:', error);
    }
  },

  guildBanAdd: async (client, ban) => {
    try {
      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId || !auditConfig.bans) return;

      const channel = ban.guild.channels.cache.get(auditConfig.channelId);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setTitle('🔨 Utilizador Banido')
        .setColor('#ED4245')
        .addFields(
          { name: '👤 Utilizador', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
          { name: '📝 Razão', value: ban.reason || 'Sem razão especificada', inline: true }
        )
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[AUDIT LOG] Erro guildBanAdd:', err.message);
    }
  },

  messageDelete: async (client, message) => {
    try {
      if (!message.guild || message.author?.bot) return;

      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId || !auditConfig.messageDelete) return;

      const channel = message.guild.channels.cache.get(auditConfig.channelId);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Mensagem Apagada')
        .setColor('#ED4245')
        .addFields(
          { name: '👤 Autor', value: message.author ? `${message.author.tag} (${message.author.id})` : 'Desconhecido', inline: true },
          { name: '💬 Canal', value: `<#${message.channelId}>`, inline: true },
          { name: '📝 Conteúdo', value: message.content ? message.content.substring(0, 1024) : '*[Sem conteúdo de texto / Embed]*' }
        )
        .setTimestamp();

      if (message.attachments.size > 0) {
        embed.addFields({ name: '📎 Anexos', value: message.attachments.map(a => a.url).join('\n').substring(0, 1024) });
      }

      await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[AUDIT LOG] Erro messageDelete:', err.message);
    }
  },

  messageUpdate: async (client, oldMessage, newMessage) => {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId || !auditConfig.messageEdit) return;

      const channel = newMessage.guild.channels.cache.get(auditConfig.channelId);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setTitle('✏️ Mensagem Editada')
        .setColor('#FEE75C')
        .addFields(
          { name: '👤 Autor', value: newMessage.author ? `${newMessage.author.tag} (${newMessage.author.id})` : 'Desconhecido', inline: true },
          { name: '💬 Canal', value: `<#${newMessage.channelId}>`, inline: true },
          { name: '📝 Antes', value: (oldMessage.content || '*[Sem conteúdo]*').substring(0, 1024) },
          { name: '📝 Depois', value: (newMessage.content || '*[Sem conteúdo]*').substring(0, 1024) },
          { name: '🔗 Link', value: `[Ir para a mensagem](${newMessage.url})` }
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[AUDIT LOG] Erro messageUpdate:', err.message);
    }
  }
};

module.exports = {
  events
};
