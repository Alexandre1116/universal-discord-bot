const { EmbedBuilder } = require('discord.js');
const RSSParser = require('rss-parser');
const { getConfig } = require('../../src/utils/config');

const rss = new RSSParser({ timeout: 10000 });
const seenVideos = new Map();
const POLL_INTERVAL = 5 * 60 * 1000;

function init(client) {
  console.log('[NOTIFICATIONS] Plugin inicializado.');

  startPolling(client);
  setInterval(() => startPolling(client), POLL_INTERVAL);
}

async function startPolling(client) {
  const config = getConfig();
  const notifications = config.notifications || {};
  const ytList = notifications.youtube || [];

  for (const yt of ytList) {
    if (!yt.channelId || !yt.discordChannelId) continue;

    try {
      const feed = await rss.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${yt.channelId}`);

      const seen = seenVideos.get(yt.channelId) || [];
      for (const item of (feed.items || []).slice(0, 3)) {
        if (seen.includes(item.id)) continue;

        seen.push(item.id);
        seenVideos.set(yt.channelId, seen.slice(-50));

        if (seen.length > 1) {
          const channel = client.channels.cache.get(yt.discordChannelId);
          if (channel) {
            const embed = new EmbedBuilder()
              .setColor('#FF0000')
              .setTitle('🔴 Novo vídeo no YouTube!')
              .setDescription(`**${item.title}**\n[Ver vídeo](${item.link})`)
              .setThumbnail(item.media?.thumbnail?.url || null)
              .setTimestamp();
            await channel.send({ content: yt.roleToPing ? `<@&${yt.roleToPing}>` : '', embeds: [embed] }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error(`[NOTIFICATIONS] Erro ao verificar canal YT ${yt.channelId}:`, err.message);
    }
  }

  const twitchList = notifications.twitch || [];
  for (const tw of twitchList) {
    if (!tw.username || !tw.discordChannelId) continue;

    try {
      const res = await fetch(`https://decapi.me/twitch/uptime/${tw.username}`);
      const text = await res.text();

      const isLive = !text.toLowerCase().includes('offline') && !text.toLowerCase().includes('error');

      const seenKey = `twitch_${tw.username}`;
      const wasLive = seenVideos.get(seenKey) || false;

      if (isLive && !wasLive) {
        seenVideos.set(seenKey, true);
        const channel = client.channels.cache.get(tw.discordChannelId);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor('#9146FF')
            .setTitle('🟣 Twitch Live!')
            .setDescription(`**${tw.username}** está em direto!\n[Ver stream](https://twitch.tv/${tw.username})`)
            .setTimestamp();
          await channel.send({ content: tw.roleToPing ? `<@&${tw.roleToPing}>` : '', embeds: [embed] }).catch(() => {});
        }
      } else if (!isLive) {
        seenVideos.set(seenKey, false);
      }
    } catch (err) {
      console.error(`[NOTIFICATIONS] Erro ao verificar Twitch ${tw.username}:`, err.message);
    }
  }
}

module.exports = { init };
