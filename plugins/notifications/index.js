const { EmbedBuilder } = require('discord.js');
const RSSParser = require('rss-parser');
const { getConfig } = require('../../src/utils/config');

const rss = new RSSParser({ timeout: 10000 });
const seenVideos = new Map();
const initializedFeeds = new Set();
const POLL_INTERVAL = 5 * 60 * 1000;

function init(client) {
  console.log('[NOTIFICATIONS] Plugin inicializado.');

  startPolling(client);
  setInterval(() => startPolling(client), POLL_INTERVAL);
}

// A Web UI grava { youtubeId, channelId, message }; o formato interno é
// { channelId (YouTube), discordChannelId }. Suportamos os dois.
function normalizeYoutube(yt) {
  const youtubeId = yt.youtubeId || yt.channelId;
  const discordChannelId = yt.discordChannelId || (yt.youtubeId ? yt.channelId : null);
  return { youtubeId, discordChannelId, message: yt.message, roleToPing: yt.roleToPing };
}

function fillTemplate(template, item, yt) {
  const text = template || `🔴 **${item.title}** acabou de sair!\n${item.link}`;
  return String(text)
    .replace(/{title}/g, item.title || '')
    .replace(/{url}/g, item.link || '')
    .replace(/{channel}/g, item.author || yt.youtubeId || '');
}

async function startPolling(client) {
  const config = getConfig();
  const notifications = config.notifications || {};
  const ytList = notifications.youtube || [];

  for (const raw of ytList) {
    const yt = normalizeYoutube(raw);
    if (!yt.youtubeId || !yt.discordChannelId) {
      console.warn('[NOTIFICATIONS] Entrada do YouTube incompleta (falta ID do canal YouTube ou canal do Discord).');
      continue;
    }

    try {
      const feed = await rss.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${yt.youtubeId}`);
      const items = (feed.items || []).slice(0, 3);

      let seen = seenVideos.get(yt.youtubeId);
      const firstRun = !seen;
      if (firstRun) seen = [];

      for (const item of items) {
        if (seen.includes(item.id)) continue;
        seen.push(item.id);

        // No primeiro arranque apenas registamos o que já existe, sem enviar tudo
        if (firstRun || !initializedFeeds.has(yt.youtubeId)) continue;

        const channel = client.channels.cache.get(yt.discordChannelId) ||
          await client.channels.fetch(yt.discordChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔴 Novo vídeo no YouTube!')
          .setDescription(fillTemplate(yt.message, item, yt))
          .setURL(item.link || null)
          .setThumbnail(item.media?.thumbnail?.url || null)
          .setTimestamp();

        await channel.send({
          content: yt.roleToPing ? `<@&${yt.roleToPing}>` : '',
          embeds: [embed]
        }).catch(() => {});
      }

      seenVideos.set(yt.youtubeId, seen.slice(-50));
      initializedFeeds.add(yt.youtubeId);
    } catch (err) {
      console.error(`[NOTIFICATIONS] Erro ao verificar canal YT ${yt.youtubeId}:`, err.message);
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
        const channel = client.channels.cache.get(tw.discordChannelId) ||
          await client.channels.fetch(tw.discordChannelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setColor('#9146FF')
            .setTitle('🟣 Twitch Live!')
            .setDescription(`**${tw.username}** está em direto!\n[Ver stream](https://twitch.tv/${tw.username})`)
            .setTimestamp();
          await channel.send({
            content: tw.roleToPing ? `<@&${tw.roleToPing}>` : '',
            embeds: [embed]
          }).catch(() => {});
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
