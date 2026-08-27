const { getConfig, updateConfig } = require('../../src/utils/config');

const tempChannels = new Map();

function init(client) {
  console.log('[VOICE HUBS] Plugin inicializado.');
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
        const pattern = hub.namePattern || '🔊 {user}';
        const channelName = pattern.replace('{user}', member.displayName || member.user.username);

        const tempChannel = await guild.channels.create({
          name: channelName,
          type: 2,
          parent: newState.channel?.parentId || null,
          userLimit: hub.userLimit || 0
        });

        await tempChannel.permissionOverwrites.create(member, {
          ManageChannels: true,
          MoveMembers: true
        });

        await member.voice.setChannel(tempChannel);

        const updated = tempChannels.get(guild.id) || [];
        updated.push({
          channelId: tempChannel.id,
          ownerId: member.id,
          hubId: hub.id
        });
        tempChannels.set(guild.id, updated);

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
            const remaining = channels.filter(c => c.channelId !== oldState.channelId);
            tempChannels.set(guild.id, remaining);
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
