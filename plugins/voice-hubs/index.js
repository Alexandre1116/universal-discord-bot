const { ChannelType } = require('discord.js');
const { getConfig, updateConfig } = require('../../src/utils/config');

// Espelho em memória de config.tempChannels (sobrevive a reinícios)
const tempChannels = new Map();
// Criações em curso (guild:membro) — evita dois canais para o mesmo membro
const hubCreations = new Set();

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
            // 10003 = o canal já não existe: há que esquecer o registo, senão o
            // erro repete-se a cada 2 minutos para sempre
            if (err.code === 10003) forget(guildId, entry.channelId);
            else console.error('[VOICE HUBS] Erro ao remover canal órfão:', err.message);
          }
        }
      }
    }
  }, 2 * 60 * 1000);
}

// Apaga o canal temporário de onde o membro saiu, se ficou vazio
async function cleanupDepartedTempChannel(guild, departedChannelId) {
  const channels = tempChannels.get(guild.id) || [];
  const tempInfo = channels.find(c => c.channelId === departedChannelId);
  if (!tempInfo) return;

  let channel = guild.channels.cache.get(departedChannelId);
  if (!channel) {
    // O canal pode não estar em cache (restart/falha de cache): confirmar antes
    // de desistir, tal como faz o cleanup periódico
    try {
      channel = await guild.channels.fetch(departedChannelId);
    } catch (err) {
      if (err.code === 10003) forget(guild.id, departedChannelId);
      return;
    }
  }
  if (!channel || channel.members.size > 0) return;

  try {
    await channel.delete('Canal temporário vazio.');
    forget(guild.id, departedChannelId);
    console.log(`[VOICE HUBS] Canal temporário removido: ${departedChannelId}`);
  } catch (err) {
    if (err.code === 10003) forget(guild.id, departedChannelId);
    else console.error('[VOICE HUBS] Erro ao remover canal temporário:', err.message);
  }
}

const events = {
  voiceStateUpdate: async (client, oldState, newState) => {
    const config = getConfig();
    const voiceHubs = config.voiceHubs || [];
    if (voiceHubs.length === 0) return;

    // O pedido de criação é identificado antes de qualquer await: a limpeza do
    // canal antigo espera pelo Discord, e sem marcação prévia dois eventos
    // quase simultâneos do mesmo membro passavam ambos o teste da trava.
    const hub = voiceHubs.find(h => h.channelId === newState.channelId);
    const realMove = oldState.channelId !== newState.channelId;
    // VoiceState.id é o user_id do membro (discord.js v14); é o que serve
    // para serializar por pessoa
    const lockKey = `${newState.guild.id}:${newState.id}`;
    let lockHeld = false;
    if (hub && realMove) {
      if (hubCreations.has(lockKey)) {
        console.log('[VOICE HUBS] Criação já em curso para este membro; a ignorar o segundo pedido.');
        return;
      }
      hubCreations.add(lockKey);
      lockHeld = true;
    }

    try {
      // 1) Saiu de um canal temporário? Tratamos primeiro: antes, quando o destino
      // era o próprio hub, o ramo do hub fazia return e o canal antigo ficava para
      // trás (só desaparecia no cleanup de 2 minutos).
      if (oldState.channelId && realMove) {
        await cleanupDepartedTempChannel(newState.guild || oldState.guild, oldState.channelId);
      }

      // 2) Entrou num hub → criar canal temporário. Só conta uma mudança real de
      // canal: eventos de mute/deafen têm o mesmo channelId e criavam canais a mais.
      if (hub && lockHeld) {
        const guild = newState.guild;
        const member = newState.member;
        if (!member) return;

        // O membro pode ter saído/trocado de canal enquanto a limpeza acima
        // esperava pelo Discord
        const liveChannelId = guild.members.cache.get(member.id)?.voice?.channelId ?? member.voice?.channelId;
        if (liveChannelId !== hub.channelId) return;

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
          // Última verificação: se o membro já não está no hub, não o movemos
          // para um canal que ele já não pediu
          const stillInHub = (guild.members.cache.get(member.id)?.voice?.channelId ?? member.voice?.channelId) === hub.channelId;
          if (!stillInHub) {
            console.log('[VOICE HUBS] Membro já não está no hub; canal temporário deixado para o cleanup.');
            return;
          }
          await member.voice.setChannel(tempChannel);
        } catch (stepErr) {
          console.error('[VOICE HUBS] Falha ao configurar/mover para o canal temporário:', stepErr.message);
        }

        console.log(`[VOICE HUBS] Canal temporário criado: ${tempChannel.name}`);
      }
    } catch (err) {
      console.error('[VOICE HUBS] Erro ao gerir canal temporário:', err.message);
    } finally {
      // Sempre libertado — também nos regressos antecipados dentro do try
      if (lockHeld) hubCreations.delete(lockKey);
    }
  }
};

module.exports = { init, events };
