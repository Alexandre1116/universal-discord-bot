const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');

module.exports = function registerMessageDelete(client) {
  client.on('messageDelete', async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;

      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId) return;
      if (!auditConfig.messageDelete) return;

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

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[AUDIT] Erro messageDelete:', err.message);
    }
  });
};
