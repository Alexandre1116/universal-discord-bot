const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../utils/config');

module.exports = function registerGuildMemberAdd(client) {
  client.on('guildMemberAdd', async (member) => {
    try {
      const config = getConfig();
      const joinConfig = config.joinMessage;

      if (!joinConfig || !joinConfig.enabled || !joinConfig.channelId) {
        return;
      }

      const channel = member.guild.channels.cache.get(joinConfig.channelId) || 
                      await member.guild.channels.fetch(joinConfig.channelId).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        console.warn(`[JOIN] Canal de boas-vindas não encontrado ou inválido: ${joinConfig.channelId}`);
        return;
      }

      const formattedContent = (joinConfig.content || 'Bem-vindo {user}!')
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{count}/g, member.guild.memberCount.toString());

      if (joinConfig.generateImage) {
        try {
          const { AttachmentBuilder } = require('discord.js');
          const Canvas = require('canvas');
          
          const canvas = Canvas.createCanvas(700, 250);
          const ctx = canvas.getContext('2d');

          // Draw Background
          let background;
          if (joinConfig.imageBackgroundUrl) {
            try {
              background = await Canvas.loadImage(joinConfig.imageBackgroundUrl);
            } catch (e) {
              console.warn('[JOIN] Erro ao carregar imagem de background. A usar cor sólida.');
            }
          }
          if (background) {
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // Text styling
          ctx.font = '28px sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('Bem-vindo ao servidor,', 225, 100);
          
          ctx.font = 'bold 36px sans-serif';
          ctx.fillStyle = joinConfig.embedColor || '#ffffff';
          ctx.fillText(member.user.username, 225, 150);
          
          ctx.font = '24px sans-serif';
          ctx.fillStyle = '#aaaaaa';
          ctx.fillText(`Membro #${member.guild.memberCount}`, 225, 190);

          // Draw Avatar
          ctx.beginPath();
          ctx.arc(125, 125, 75, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.clip();
          
          const avatar = await Canvas.loadImage(member.user.displayAvatarURL({ extension: 'png' }));
          ctx.drawImage(avatar, 50, 50, 150, 150);

          const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'welcome-image.png' });

          if (joinConfig.messageType === 'embed') {
            const embed = new EmbedBuilder()
              .setTitle(joinConfig.embedTitle || '👋 Novo Membro!')
              .setDescription(formattedContent)
              .setColor(joinConfig.embedColor || '#5865F2')
              .setImage('attachment://welcome-image.png')
              .setTimestamp();
            await channel.send({ embeds: [embed], files: [attachment] });
          } else {
            await channel.send({ content: formattedContent, files: [attachment] });
          }
        } catch (imgError) {
          console.error('[JOIN] Erro a desenhar imagem de canvas:', imgError);
          // Fallback para envio normal caso a imagem falhe
          if (joinConfig.messageType === 'embed') {
             const embed = new EmbedBuilder().setTitle(joinConfig.embedTitle || '👋 Novo Membro!').setDescription(formattedContent).setColor(joinConfig.embedColor || '#5865F2');
             if(joinConfig.showAvatar) embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
             await channel.send({ embeds: [embed] });
          } else {
             await channel.send({ content: formattedContent });
          }
        }
      } else {
        if (joinConfig.messageType === 'embed') {
          const embed = new EmbedBuilder()
            .setTitle(joinConfig.embedTitle || '👋 Novo Membro!')
            .setDescription(formattedContent)
            .setColor(joinConfig.embedColor || '#5865F2')
            .setTimestamp();

          if (joinConfig.showAvatar) {
            embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
          }

          await channel.send({ embeds: [embed] });
        } else {
          await channel.send({ content: formattedContent });
        }
      }

      console.log(`[JOIN] Mensagem de boas-vindas enviada para ${member.user.tag}`);
    } catch (error) {
      console.error('[JOIN] Erro ao enviar mensagem de entrada:', error);
    }
  });
};
