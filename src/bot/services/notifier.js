const Parser = require('rss-parser');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../../utils/config');

const parser = new Parser();
const DATA_DIR = path.join(__dirname, '../../../data');
const NOTIFIED_VIDEOS_FILE = path.join(DATA_DIR, 'notified_videos.json');

let notifiedVideos = [];
if (fs.existsSync(NOTIFIED_VIDEOS_FILE)) {
  try {
    notifiedVideos = JSON.parse(fs.readFileSync(NOTIFIED_VIDEOS_FILE, 'utf8'));
  } catch (err) {
    notifiedVideos = [];
  }
}

function saveNotifiedVideos() {
  fs.writeFileSync(NOTIFIED_VIDEOS_FILE, JSON.stringify(notifiedVideos, null, 2));
}

function initNotifier(client) {
  // Check every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    const config = getConfig();
    if (!config.notifications || !config.notifications.youtube || config.notifications.youtube.length === 0) return;

    for (const notif of config.notifications.youtube) {
      if (!notif.channelId || !notif.youtubeId) continue;
      try {
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${notif.youtubeId}`;
        const feed = await parser.parseURL(feedUrl);
        if (feed.items && feed.items.length > 0) {
          const latestVideo = feed.items[0];
          
          if (!notifiedVideos.includes(latestVideo.id)) {
            // New video found
            const discordChannel = await client.channels.fetch(notif.channelId).catch(() => null);
            if (discordChannel && discordChannel.isTextBased()) {
              const message = notif.message 
                ? notif.message.replace('{url}', latestVideo.link).replace('{title}', latestVideo.title).replace('{author}', feed.title)
                : `🎥 **${feed.title}** acabou de publicar um novo vídeo: **${latestVideo.title}**!\n${latestVideo.link}`;
                
              await discordChannel.send({ content: message });
              notifiedVideos.push(latestVideo.id);
              saveNotifiedVideos();
            }
          }
        }
      } catch (err) {
        console.error(`[NOTIFIER] Erro ao verificar YouTube (${notif.youtubeId}):`, err.message);
      }
    }
  });
}

module.exports = { initNotifier };
