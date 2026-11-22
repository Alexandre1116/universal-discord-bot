const { ChannelType } = require('discord.js');
const { getConfig, updateConfig } = require('../../src/utils/config');

// Espelho em memória de config.tempChannels (sobrevive a reinícios)
const tempChannels = new Map();

function indexFromConfig() {
  tempChannels.clear();
  const stored = getConfig().tempChannels || [];
  for (const entry of stored) {
    if (!entry || !entry.channelId || !entry.guildId) continue;
    if (!tempChannels.has(entry.guildId)) tempChannels.set(entry.guildId, []);
    tempChannels.get(entry.guildId).push(entry);
  }
}

function persist(guildId) {
  const stored = (getConfig().tempChannels || []).filter(c => c.guildId !== guildId);
  updateConfig({ tempChannels: [...stored, ...(tempChannels.get(guildId) || [])] });
}

function remember(guildId, entry) {
  if (!tempChannels.has(guildId)) tempChannels.set(guildId, []);
  tempChannels.get(guildId).push(entry);
  persist(guildId);
}

function forget(guildId, channelId) {
  const list = tempChannels.get(guildId) || [];
  tempChannels.set(guildId, list.filter(c => c.channelId !== channelId));
  persist(guildId);
}

function init(client) {
  indexFromConfig();
  console.log(`[VOICE HUBS] Plugin inicializado (${[...tempChannels.values()].reduce((a, b) => a + b.length, 0)} canais temporários conhecidos).`);

  // Limpeza periódica: remove canais órfãos (bot reiniciou, membros saíram todos, etc.)
  setInterval(async () => {
    for (const [guildId, entries] of [...tempChannels.entries()]) {
      const guild = client.guilds.cache.get(guildId);
      for (const entry of [...entries]) {
        if (!guild) {
          forget(guildId, entry.channelId);
          continue;
        }
        const channel = guild.channels.cache.get(entry.channelId);
        if (!channel) {
          forget(guildId, entry.channelId);
          continue;
        }
        if (channel.members.size === 0) {
          try {
            await channel.delete('Canal temporário vazio.');
            forget(guildId, entry.channelId);
          } catch (err) {
            console.error('[VOICE HUBS] Erro ao remover canal órfão:', err.message);
          }
        }
      }
    }
  }, 2 * 60 * 1000);
}

const events = {
  voiceStateUpdate: async (client, oldState, newState) => {
    const config = getConfig();
    const voiceHubs = config.voiceHubs || [];
    if (voiceHubs.length === 0) return;

    const hub = voiceHubs.find(h => h.channelId === newState.channelId);
    if (hub) {
      try {
        const guild = newState.guild;
        const member = newState.member;
        if (!member) return;

        const sourceChannel = guild.channels.cache.get(hub.channelId);
        const pattern = hub.namePattern || '🔊 {user}';
        const channelName = pattern
          .replace(/{user}/g, member.displayName || member.user.username)
          .replace(/{channel}/g, sourceChannel ? sourceChannel.name : '');

        const tempChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: sourceChannel?.parentId ?? newState.channel?.parentId ?? null,
          userLimit: hub.userLimit || 0,
          bitrate: sourceChannel?.bitrate,
          reason: `Canal temporário de ${member.user.tag}`
        });

        await tempChannel.permissionOverwrites.create(member, {
          ManageChannels: true,
          MoveMembers: true
        });

        await member.voice.setChannel(tempChannel);

        remember(guild.id, {
          channelId: tempChannel.id,
          ownerId: member.id,
          hubId: hub.id,
          guildId: guild.id,
          createdAt: new Date().toISOString()
        });

        console.log(`[VOICE HUBS] Canal temporário criado: ${tempChannel.name}`);
      } catch (err) {
        console.error('[VOICE HUBS] Erro ao criar canal temporário:', err.message);
      }
      return;
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const guild = newState.guild;
      const channels = tempChannels.get(guild.id) || [];
      const tempInfo = channels.find(c => c.channelId === oldState.channelId);
      if (tempInfo) {
        const channel = guild.channels.cache.get(oldState.channelId);
        if (channel && channel.members.size === 0) {
          try {
            await channel.delete('Canal temporário vazio.');
            forget(guild.id, oldState.channelId);
            console.log(`[VOICE HUBS] Canal temporário removido: ${oldState.channelId}`);
          } catch (err) {
            console.error('[VOICE HUBS] Erro ao remover canal temporário:', err.message);
          }
        }
      }
    }
  }
};

module.exports = { init, events };
