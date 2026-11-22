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

// O mapa em memória é a fonte de verdade das entradas: evita o read-modify-write
// de config.json, que podia perder entradas de outros servidores quando duas
// escritas se entrelaçavam
function persist() {
  const all = [];
  for (const list of tempChannels.values()) all.push(...list);
  const saved = updateConfig({ tempChannels: all });
  if (!saved) console.error('[VOICE HUBS] Falha ao persistir canais temporários no config.json.');
}

function remember(guildId, entry) {
  if (!tempChannels.has(guildId)) tempChannels.set(guildId, []);
  tempChannels.get(guildId).push(entry);
  persist();
}

function forget(guildId, channelId) {
  const list = tempChannels.get(guildId) || [];
  tempChannels.set(guildId, list.filter(c => c.channelId !== channelId));
  persist();
}

function init(client) {
  indexFromConfig();
  console.log(`[VOICE HUBS] Plugin inicializado (${[...tempChannels.values()].reduce((a, b) => a + b.length, 0)} canais temporários conhecidos).`);

  // Limpeza periódica: remove canais órfãos (bot reiniciou, membros saíram todos, etc.)
  setInterval(async () => {
    for (const [guildId, entries] of [...tempChannels.entries()]) {
      const guild = client.guilds.cache.get(guildId);
      for (const entry of [...entries]) {
        // Servidor fora de cache pode ser transitório: manter o registo
        if (!guild) continue;

        let channel = guild.channels.cache.get(entry.channelId);
        if (!channel) {
          try {
            channel = await guild.channels.fetch(entry.channelId);
          } catch (err) {
            // 10003 = Unknown Channel → mesmo assim o canal já não existe
            if (err.code === 10003) forget(guildId, entry.channelId);
            continue;
          }
        }

        if (channel && channel.members.size === 0) {
          try {
            await channel.delete('Canal temporário vazio.');
            forget(guildId, entry.channelId);
            console.log(`[VOICE HUBS] Canal temporário órfão removido: ${entry.channelId}`);
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
          ...(sourceChannel?.bitrate ? { bitrate: sourceChannel.bitrate } : {}),
          reason: `Canal temporário de ${member.user.tag}`
        });

        // Regista JÁ o canal: se um dos passos seguintes falhar (por exemplo o
        // membro ter saído entretanto), o canal continua a ser conhecido e o
        // cleanup periódico apaga-o em vez de o deixar órfão.
        remember(guild.id, {
          channelId: tempChannel.id,
          ownerId: member.id,
          hubId: hub.id,
          guildId: guild.id,
          createdAt: new Date().toISOString()
        });

        try {
          await tempChannel.permissionOverwrites.create(member, {
            ManageChannels: true,
            MoveMembers: true
          });
          await member.voice.setChannel(tempChannel);
        } catch (stepErr) {
          console.error('[VOICE HUBS] Falha ao configurar/mover para o canal temporário:', stepErr.message);
        }

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
