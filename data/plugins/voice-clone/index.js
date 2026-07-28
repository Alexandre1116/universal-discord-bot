const { ChannelType } = require('discord.js');
const path = require('path');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');
const { getConfig, updateConfig } = require(configPath);

const activeTempChannels = new Set();

const events = {
  ready: async (client) => {
    try {
      const config = getConfig();
      if (Array.isArray(config.tempChannels)) {
        config.tempChannels.forEach(id => activeTempChannels.add(id));
      }

      for (const channelId of Array.from(activeTempChannels)) {
        try {
          const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
          if (channel) {
            if (channel.members.size === 0) {
              await channel.delete('Limpeza de canal temporário antigo ao iniciar');
              activeTempChannels.delete(channelId);
              console.log(`[VOICE CLONE] Canal temporário antigo eliminado: ${channelId}`);
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
      console.error('[VOICE CLONE] Erro durante inicialização:', err);
    }
  },

  voiceStateUpdate: async (client, oldState, newState) => {
    const config = getConfig();
    if (config.modules?.voiceClone === false) return; // Módulo desativado? Assumimos ativado por defeito neste caso se o plugin está on, mas mantemos o check.

    try {
      const voiceHubs = config.voiceHubs || [];

      // 1. UTILIZADOR ENTROU NUM CANAL
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        const hubConfig = voiceHubs.find(h => h.channelId === newState.channelId);

        if (hubConfig) {
          const guild = newState.guild;
          const member = newState.member;
          const hubChannel = newState.channel;

          console.log(`[VOICE CLONE] Membro ${member.user.tag} entrou no canal Hub ${hubChannel.name} (${hubChannel.id})`);

          const rawPattern = hubConfig.namePattern || '🔊 {user}';
          const newChannelName = rawPattern
            .replace(/{user}/g, member.displayName || member.user.username)
            .replace(/{username}/g, member.user.username)
            .replace(/{channel}/g, hubChannel.name);

          const permissionOverwrites = hubChannel.permissionOverwrites.cache.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
            type: overwrite.type
          }));

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

          activeTempChannels.add(newVoiceChannel.id);
          updateConfig({ tempChannels: Array.from(activeTempChannels) });

          await member.voice.setChannel(newVoiceChannel).catch(err => {
            console.error(`[VOICE CLONE] Erro ao mover membro ${member.user.tag}:`, err);
          });
        }
      }

      // 2. UTILIZADOR SAIU DE UM CANAL
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        if (activeTempChannels.has(oldState.channelId)) {
          const oldChannel = oldState.channel || 
                            await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);

          if (oldChannel && oldChannel.members.size === 0) {
            console.log(`[VOICE CLONE] Canal temporário ${oldChannel.name} (${oldChannel.id}) ficou vazio. Eliminando...`);
            await oldChannel.delete('Canal temporário ficou vazio').catch(() => null);
            activeTempChannels.delete(oldState.channelId);
            updateConfig({ tempChannels: Array.from(activeTempChannels) });
          }
        }
      }
    } catch (error) {
      console.error('[VOICE CLONE] Erro:', error);
    }
  }
};

module.exports = {
  events
};
