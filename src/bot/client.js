const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getConfig } = require('../utils/config');
const { DisTube } = require('distube');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Channel]
});

// Inicializar o DisTube
client.distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  emitAddListWhenCreatingQueue: false,
});

// Eventos do DisTube básicos
client.distube
  .on('playSong', (queue, song) =>
    queue.textChannel.send(`🎶 A tocar agora: \`${song.name}\` - \`${song.formattedDuration}\` (Adicionado por: ${song.user})`)
  )
  .on('addSong', (queue, song) =>
    queue.textChannel.send(`✅ Adicionado à fila: \`${song.name}\` - \`${song.formattedDuration}\``)
  )
  .on('error', (channel, e) => {
    if (channel) channel.send(`❌ Ocorreu um erro: ${e.toString().slice(0, 1974)}`);
    else console.error('[DISTUBE ERRO]', e);
  })
  .on('empty', queue => queue.textChannel.send('A sala de voz está vazia. Saindo...'))
  .on('searchNoResult', (message, query) =>
    message.channel.send(`❌ Não encontrei resultados para: \`${query}\`!`)
  )
  .on('finish', queue => queue.textChannel.send('Fila terminada.'));

let isBotReady = false;

client.once('ready', () => {
  isBotReady = true;
  console.log(`[BOT] Bot ligado com sucesso como: ${client.user.tag}`);
  
  const config = getConfig();
  if (config.presence) {
    const typeMap = {
      'Playing': 0, 'Streaming': 1, 'Listening': 2, 'Watching': 3, 'Custom': 4, 'Competing': 5
    };
    client.user.setPresence({
      status: config.presence.status || 'online',
      activities: config.presence.activityText ? [{
        name: config.presence.activityText,
        type: typeMap[config.presence.activityType] || 0
      }] : []
    });
  }

  // --- AUTOMATED BACKUPS ---
  const cron = require('node-cron');
  const fs = require('fs');
  const path = require('path');
  const { AttachmentBuilder } = require('discord.js');
  
  // Agendar para todos os dias à meia-noite (00:00)
  cron.schedule('0 0 * * *', async () => {
    const currentConfig = getConfig();
    if (currentConfig.backup && currentConfig.backup.autoBackup && currentConfig.backup.channelId) {
      try {
        const channel = await client.channels.fetch(currentConfig.backup.channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const DATA_DIR = path.join(__dirname, '../../data');
          const files = [];
          
          if (fs.existsSync(path.join(DATA_DIR, 'config.json'))) {
            files.push(new AttachmentBuilder(path.join(DATA_DIR, 'config.json'), { name: 'config.json' }));
          }
          if (fs.existsSync(path.join(DATA_DIR, 'data.db'))) {
            files.push(new AttachmentBuilder(path.join(DATA_DIR, 'data.db'), { name: 'data.db' }));
          }
          
          if (files.length > 0) {
            await channel.send({ content: `📦 **Backup Diário Automático** (${new Date().toLocaleDateString('pt-PT')})`, files });
            console.log('[BACKUP] Backup diário enviado com sucesso.');
          }
        }
      } catch (err) {
        console.error('[BACKUP] Falha ao enviar backup automático:', err);
      }
    }
  });

  // --- NOTIFICATIONS (YouTube/Twitch) ---
  try {
    const { initNotifier } = require('./services/notifier');
    initNotifier(client);
  } catch (err) {
    console.error('[NOTIFIER] Erro ao iniciar notifier:', err.message);
  }
});

function initBot() {
  const config = getConfig();
  const token = process.env.DISCORD_TOKEN || config.token;

  if (!token || token.trim() === '') {
    console.warn('[BOT] Token do Bot não configurado! Define DISCORD_TOKEN no .env ou no Web UI.');
    return false;
  }

  client.login(token.trim()).catch(err => {
    console.error('[BOT] Falha ao efetuar login no Discord:', err.message);
  });
  return true;
}

function getBotStatus() {
  return {
    isReady: isBotReady,
    user: client.user ? {
      username: client.user.username,
      discriminator: client.user.discriminator,
      tag: client.user.tag,
      avatar: client.user.displayAvatarURL(),
      id: client.user.id
    } : null,
    guildsCount: client.guilds.cache.size,
    ping: client.ws ? client.ws.ping : -1
  };
}

module.exports = {
  client,
  initBot,
  getBotStatus
};
