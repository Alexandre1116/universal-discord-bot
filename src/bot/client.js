const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { getConfig } = require('../utils/config');


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

// O Distube e outros plugins são agora inicializados dinamicamente pelo pluginManager

let isBotReady = false;

client.once(Events.ClientReady, () => {
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
            // O canal de Discord NÃO fica com segredos: token, credenciais do
            // painel e session secret são removidos do anexo. O backup completo
            // (com segredos) continua disponível no painel em /api/backup.
            const sanitized = { ...currentConfig };
            delete sanitized.token;
            delete sanitized.webAuth;
            delete sanitized.sessionSecret;
            sanitized._backupNota = 'Anexo sem token/credenciais. Usa o painel (Backup & Restauro) para o backup completo.';
            files.push(new AttachmentBuilder(Buffer.from(JSON.stringify(sanitized, null, 2), 'utf8'), { name: 'config.json' }));
          }
          if (fs.existsSync(path.join(DATA_DIR, 'data.db'))) {
            // as escritas de estatísticas/XP podem estar em fila (até 2 s)
            require('../utils/database').flushNow();
            files.push(new AttachmentBuilder(path.join(DATA_DIR, 'data.db'), { name: 'data.db' }));
          }
          
          if (files.length > 0) {
            // honesto sobre o alcance do anexo: a BD não é filtrada e contém os
            // dados de TODOS os servidores onde o bot está
            await channel.send({
              content: `📦 **Backup Diário Automático** (${new Date().toLocaleDateString('pt-PT')})\n⚠️ O anexo \`data.db\` contém todos os dados guardados pelo bot (XP, avisos, tickets, sorteios e histórico) de **todos** os servidores — qualquer pessoa que consiga ler este canal consegue descarregá-lo.`,
              files
            });
            console.log('[BACKUP] Backup diário enviado com sucesso.');
          }
        }
      } catch (err) {
        console.error('[BACKUP] Falha ao enviar backup automático:', err);
      }
    }
  });
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
