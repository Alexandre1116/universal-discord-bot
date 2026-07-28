const { ChannelType, EmbedBuilder } = require('discord.js');
const { getConfig, updateConfig } = require('../../utils/config');

// Guardar IDs de canais temporários ativos em memória
const activeTempChannels = new Set();

module.exports = function registerVoiceStateUpdate(client) {
  // Inicialização e limpeza ao ligar
  client.once('ready', async () => {
    try {
      const config = getConfig();
      if (Array.isArray(config.tempChannels)) {
        config.tempChannels.forEach(id => activeTempChannels.add(id));
      }

      // Limpar canais vazios restantes de sessões anteriores
      for (const channelId of Array.from(activeTempChannels)) {
        try {
          const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
          if (channel) {
            if (channel.members.size === 0) {
              await channel.delete('Limpeza de canal temporário antigo ao iniciar');
              activeTempChannels.delete(channelId);
              console.log(`[VOICE] Canal temporário antigo eliminado: ${channelId}`);
            }
          } else {
            activeTempChannels.delete(channelId);
          }
        } catch (err) {
          activeTempChannels.delete(channelId);
        }
      }

      updateConfig({ tempChannels: Array.from(activeTempChannels) });
    } catch (err) {
      console.error('[VOICE] Erro durante inicialização de canais de voz:', err);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const config = getConfig();
      const voiceHubs = config.voiceHubs || [];

      // 1. UTILIZADOR ENTROU NUM CANAL
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        const hubConfig = voiceHubs.find(h => h.channelId === newState.channelId);

        if (hubConfig) {
          const guild = newState.guild;
          const member = newState.member;
          const hubChannel = newState.channel;

          console.log(`[VOICE] Membro ${member.user.tag} entrou no canal Hub ${hubChannel.name} (${hubChannel.id})`);

          // Determinar o nome do novo canal clonado
          const rawPattern = hubConfig.namePattern || '🔊 {user}';
          const newChannelName = rawPattern
            .replace(/{user}/g, member.displayName || member.user.username)
            .replace(/{username}/g, member.user.username)
            .replace(/{channel}/g, hubChannel.name);

          // Mapear permissões exatas do canal original (cópia 1:1)
          const permissionOverwrites = hubChannel.permissionOverwrites.cache.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
            type: overwrite.type
          }));

          // Adicionar permissão explícita para o criador se necessário
          // Criar canal de voz cópia exata
          const newVoiceChannel = await guild.channels.create({
            name: newChannelName,
            type: ChannelType.GuildVoice,
            parent: hubChannel.parentId,
            bitrate: hubChannel.bitrate,
            userLimit: hubConfig.userLimit && hubConfig.userLimit > 0 ? hubConfig.userLimit : hubChannel.userLimit,
            permissionOverwrites: permissionOverwrites,
            rtcRegion: hubChannel.rtcRegion,
            reason: `Canal temporário clonado a partir de ${hubChannel.name} para ${member.user.tag}`
          });

          // Adicionar aos canais temporários ativos
          activeTempChannels.add(newVoiceChannel.id);
          updateConfig({ tempChannels: Array.from(activeTempChannels) });

          // Mover o membro para o novo canal clonado
          await member.voice.setChannel(newVoiceChannel).catch(err => {
            console.error(`[VOICE] Erro ao mover membro ${member.user.tag} para ${newVoiceChannel.name}:`, err);
          });

          console.log(`[VOICE] Canal clonado criado (${newVoiceChannel.name}) e membro movido com sucesso!`);
        }
      }

      // 2. UTILIZADOR SAIU DE UM CANAL (OU MUDOU DE CANAL)
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        if (activeTempChannels.has(oldState.channelId)) {
          const oldChannel = oldState.channel || 
                            await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);

          if (oldChannel && oldChannel.members.size === 0) {
            console.log(`[VOICE] Canal temporário ${oldChannel.name} (${oldChannel.id}) ficou vazio. Eliminando...`);
            await oldChannel.delete('Canal temporário ficou vazio').catch(() => null);
            activeTempChannels.delete(oldState.channelId);
            updateConfig({ tempChannels: Array.from(activeTempChannels) });
          }
        }
      }
      // 3. AUDIT LOG DE VOZ
      const auditConfig = config.auditLog || {};
      if (auditConfig.enabled && auditConfig.channelId && auditConfig.voiceJoinLeave) {
        const auditChannel = newState.guild.channels.cache.get(auditConfig.channelId);
        if (auditChannel && auditChannel.isTextBased()) {
          const member = newState.member || oldState.member;
          if (member && !member.user.bot) {
            // Entrou num canal
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
            }
            // Saiu de um canal
            else if (oldState.channelId && !newState.channelId) {
              const embed = new EmbedBuilder()
                .setTitle('🔇 Membro Saiu de Canal de Voz')
                .setColor('#ED4245')
                .addFields(
                  { name: '👤 Membro', value: `${member.user.tag}`, inline: true },
                  { name: '🔊 Canal', value: `<#${oldState.channelId}>`, inline: true }
                )
                .setTimestamp();
              await auditChannel.send({ embeds: [embed] }).catch(() => {});
            }
            // Mudou de canal
            else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
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
          }
        }
      }
    } catch (error) {
      console.error('[VOICE] Erro no evento voiceStateUpdate:', error);
    }
  });
};
