const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { recordMemberCount } = require('../../utils/database');

module.exports = function registerGuildMemberRemove(client) {
  client.on('guildMemberRemove', async (member) => {
    try {
      // Alimenta o gráfico de crescimento de membros da Web UI
      try { recordMemberCount(member.guild.id, member.guild.memberCount); } catch (e) { /* stats não podem rebentar o fluxo */ }

      const config = getConfig();
      const modules = config.modules || {};
      if (modules.welcome === false) return;

      const leaveConfig = config.leaveMessage;

      if (!leaveConfig || !leaveConfig.enabled || !leaveConfig.channelId) {
        return;
      }

      const channel = member.guild.channels.cache.get(leaveConfig.channelId) || 
                      await member.guild.channels.fetch(leaveConfig.channelId).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        console.warn(`[LEAVE] Canal de despedida não encontrado ou inválido: ${leaveConfig.channelId}`);
        return;
      }

      const formattedContent = (leaveConfig.content || '{user} saiu do servidor.')
        .replace(/{user}/g, `**${member.user.tag}**`)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{count}/g, member.guild.memberCount.toString());

      if (leaveConfig.messageType === 'embed') {
        const embed = new EmbedBuilder()
          .setTitle(leaveConfig.embedTitle || '🚪 Membro Saiu')
          .setDescription(formattedContent)
          .setColor(leaveConfig.embedColor || '#ED4245')
          .setTimestamp();

        if (leaveConfig.showAvatar) {
          embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
        }

        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: formattedContent });
      }

      console.log(`[LEAVE] Mensagem de saída enviada para ${member.user.tag}`);
    } catch (error) {
      console.error('[LEAVE] Erro ao enviar mensagem de saída:', error);
    }
  });
};
