const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');

module.exports = function registerMessageUpdate(client) {
  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId) return;
      if (!auditConfig.messageEdit) return;

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

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[AUDIT] Erro messageUpdate:', err.message);
    }
  });
};
