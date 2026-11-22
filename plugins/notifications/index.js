const { EmbedBuilder } = require('discord.js');
const RSSParser = require('rss-parser');
const { getConfig } = require('../../src/utils/config');

const rss = new RSSParser({ timeout: 10000 });
// Estado por (canal de origem, canal do Discord): duas subscrições do mesmo
// canal de YouTube para Discord diferentes não comem uma à outra o aviso
const seenItems = new Map();
const POLL_INTERVAL = 5 * 60 * 1000;
let polling = false;

function init(client) {
  console.log('[NOTIFICATIONS] Plugin inicializado.');

  startPolling(client);
  setInterval(() => startPolling(client), POLL_INTERVAL);
}

// A Web UI grava { youtubeId, channelId }; o formato interno é
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
  if (polling) {
    console.warn('[NOTIFICATIONS] Ronda anterior ainda a correr, a saltar esta.');
    return;
  }
  polling = true;

  try {
    const config = getConfig();
    const notifications = config.notifications || {};
    const ytList = notifications.youtube || [];

    for (const raw of ytList) {
      const yt = normalizeYoutube(raw);
      if (!yt.youtubeId || !yt.discordChannelId) {
        console.warn('[NOTIFICATIONS] Entrada do YouTube incompleta (falta ID do canal YouTube ou canal do Discord).');
        continue;
      }

      const feedKey = `yt:${yt.youtubeId}:${yt.discordChannelId}`;

      try {
        const feed = await rss.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(yt.youtubeId)}`);
        const items = (feed.items || []).slice(0, 3);

        let seen = seenItems.get(feedKey);
        const firstRun = !seen;
        if (firstRun) seen = [];

        for (const item of items) {
          if (seen.includes(item.id)) continue;

          // No primeiro arranque só registamos o que já existe (sem enviar o
          // histórico recente como se fosse novidade)
          if (firstRun) {
            seen.push(item.id);
            continue;
          }

          const channel = client.channels.cache.get(yt.discordChannelId) ||
            await client.channels.fetch(yt.discordChannelId).catch(() => null);
          if (!channel || !channel.isTextBased()) {
            console.warn(`[NOTIFICATIONS] Canal Discord ${yt.discordChannelId} indisponível; aviso adiado.`);
            continue; // não consome o item: tenta na próxima ronda
          }

          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🔴 Novo vídeo no YouTube!')
            .setDescription(fillTemplate(yt.message, item, yt))
            .setURL(item.link || null)
            .setThumbnail(item.media?.thumbnail?.url || null)
            .setTimestamp();

          try {
            await channel.send({
              content: yt.roleToPing ? `<@&${yt.roleToPing}>` : '',
              embeds: [embed]
            });
            seen.push(item.id); // só marca como enviado depois de entregar
          } catch (sendErr) {
            console.error(`[NOTIFICATIONS] Falha a enviar aviso (${item.id}):`, sendErr.message);
          }
        }

        seenItems.set(feedKey, seen.slice(-50));
      } catch (err) {
        console.error(`[NOTIFICATIONS] Erro ao verificar canal YT ${yt.youtubeId}:`, err.message);
      }
    }

    const twitchList = notifications.twitch || [];
    for (const tw of twitchList) {
      if (!tw.username || !tw.discordChannelId) continue;

      const liveKey = `twitch:${tw.username.toLowerCase()}:${tw.discordChannelId}`;

      try {
        const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined;
        const res = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(tw.username)}`, { signal });
        if (!res.ok) {
          console.warn(`[NOTIFICATIONS] Twitch ${tw.username}: fornecedor respondeu HTTP ${res.status}.`);
          continue;
        }
        const text = (await res.text()).trim();

        // O decapi devolve a duração ("2 hours, 25 minutes") quando está em
        // direto e coisas como "offline", "No user with the name X found" ou
        // avisos de rate-limit quando não está. Detetar em POSITIVO e com o
        // corpo inteiro ancorado: "try again in 30 seconds" também tem número +
        // unidade e contava como direto.
        const providerError = /not\s+found|error|rate limit|too many|slow|invalid|forbidden|unauthorized/i.test(text);
        if (providerError) {
          console.warn(`[NOTIFICATIONS] Twitch ${tw.username}: erro do fornecedor ("${text.slice(0, 80)}"); estado mantém-se.`);
          continue;
        }

        const isLive = /^\d+\s*(seconds?|minutes?|hours?|days?)([,\s]+\d+\s*(seconds?|minutes?|hours?|days?))*$/i.test(text);
        const isOffline = /offline/i.test(text);
        if (!isLive && !isOffline) {
          console.warn(`[NOTIFICATIONS] Twitch ${tw.username}: resposta não reconhecida ("${text.slice(0, 80)}"); estado não alterado.`);
          continue;
        }

        const wasLive = seenItems.get(liveKey);
        // Primeira verificação depois do arranque: só regista o estado (senão um
        // restart com o streamer em direto volta a anunciar a mesma stream)
        if (wasLive === undefined) {
          seenItems.set(liveKey, isLive);
          continue;
        }

        if (isLive && wasLive !== true) {
          const channel = client.channels.cache.get(tw.discordChannelId) ||
            await client.channels.fetch(tw.discordChannelId).catch(() => null);
          if (!channel || !channel.isTextBased()) {
            console.warn(`[NOTIFICATIONS] Canal Discord ${tw.discordChannelId} indisponível; aviso Twitch adiado.`);
            continue;
          }

          const embed = new EmbedBuilder()
            .setColor('#9146FF')
            .setTitle('🟣 Twitch Live!')
            .setDescription(`**${tw.username}** está em direto!\n[Ver stream](https://twitch.tv/${encodeURIComponent(tw.username)})`)
            .setTimestamp();

          try {
            await channel.send({
              content: tw.roleToPing ? `<@&${tw.roleToPing}>` : '',
              embeds: [embed]
            });
            seenItems.set(liveKey, true);
          } catch (sendErr) {
            console.error(`[NOTIFICATIONS] Falha a enviar aviso Twitch (${tw.username}):`, sendErr.message);
          }
        } else if (!isLive) {
          seenItems.set(liveKey, false);
        }
      } catch (err) {
        console.error(`[NOTIFICATIONS] Erro ao verificar Twitch ${tw.username}:`, err.message);
      }
    }
  } finally {
    polling = false;
  }
}

module.exports = { init };
