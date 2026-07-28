const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');

module.exports = function registerGuildBanAdd(client) {
  client.on('guildBanAdd', async (ban) => {
    try {
      const config = getConfig();
      const auditConfig = config.auditLog || {};
      if (!auditConfig.enabled || !auditConfig.channelId) return;
      if (!auditConfig.bans) return;

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

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[AUDIT] Erro guildBanAdd:', err.message);
    }
  });
};
