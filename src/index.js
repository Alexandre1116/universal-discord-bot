require('dotenv').config();
require('./utils/logger'); // Inicia a interceção de logs
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const cron = require('node-cron');

const registerGuildMemberAdd = require('./bot/events/guildMemberAdd');
const registerGuildMemberRemove = require('./bot/events/guildMemberRemove');
const registerVoiceStateUpdate = require('./bot/events/voiceStateUpdate');
const registerInteractionCreate = require('./bot/events/interactionCreate');
const registerMessageCreate = require('./bot/events/messageCreate');
const registerMessageDelete = require('./bot/events/messageDelete');
const registerMessageUpdate = require('./bot/events/messageUpdate');
const registerGuildBanAdd = require('./bot/events/guildBanAdd');
const { client, initBot } = require('./bot/client');
const { registerCommands } = require('./bot/commands/register');
const apiRoutes = require('./server/api');
const apiExtendedRoutes = require('./server/apiExtended');
const { authMiddleware, setupAuthRoutes } = require('./server/auth');
const { getDb, getActiveGiveaways, endGiveaway, getGiveawayEntries, getAllScheduledMessages, recordMemberCount } = require('./utils/database');
const { finishGiveaway } = require('./bot/commands/giveaway');
const { getConfig } = require('./utils/config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'discord-bot-super-secret-key-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Servir ficheiros estáticos
app.use(express.static(path.join(__dirname, '../public')));

// Auth routes (antes do middleware)
setupAuthRoutes(app);

// Auth middleware para proteger API (se OAuth ativo)
app.use('/api', authMiddleware);

// Rotas API
app.use('/api', apiRoutes);
app.use('/api', apiExtendedRoutes);

// Rota genérica para servir a Web UI (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Registar Eventos do Bot
registerGuildMemberAdd(client);
registerGuildMemberRemove(client);
registerVoiceStateUpdate(client);
registerInteractionCreate(client);
registerMessageCreate(client);
registerMessageDelete(client);
registerMessageUpdate(client);
registerGuildBanAdd(client);

// Quando o bot está pronto, registar slash commands e iniciar tarefas
client.once('ready', async () => {
  // Registar slash commands
  const clientId = process.env.CLIENT_ID || getConfig().clientId || client.user.id;
  const token = process.env.DISCORD_TOKEN || getConfig().token;
  await registerCommands(clientId, token);

  // Inicializar base de dados
  await getDb();

  // Iniciar o sistema de giveaways (verificar a cada 30 segundos)
  startGiveawayChecker();

  // Iniciar o sistema de mensagens agendadas
  startScheduledMessages();

  // Registar contagem de membros periodicamente (a cada hora)
  startMemberCountRecorder();
});

// --- GIVEAWAY CHECKER ---
function startGiveawayChecker() {
  setInterval(async () => {
    try {
      const activeGiveaways = getActiveGiveaways();
      const now = new Date();

      for (const giveaway of activeGiveaways) {
        const endsAt = new Date(giveaway.ends_at);
        if (now >= endsAt) {
          console.log(`[GIVEAWAY] Sorteio "${giveaway.prize}" terminou!`);
          await finishGiveaway(client, giveaway);
        }
      }
    } catch (err) {
      console.error('[GIVEAWAY] Erro no checker:', err.message);
    }
  }, 30000); // Verificar a cada 30 segundos
}

// --- SCHEDULED MESSAGES ---
const scheduledJobs = new Map();

function startScheduledMessages() {
  // Recarregar mensagens agendadas a cada minuto
  setInterval(() => {
    try {
      const messages = getAllScheduledMessages();

      // Limpar jobs antigos
      for (const [id, job] of scheduledJobs) {
        if (!messages.find(m => m.id === id)) {
          job.stop();
          scheduledJobs.delete(id);
        }
      }

      // Criar novos jobs
      for (const msg of messages) {
        if (scheduledJobs.has(msg.id)) continue;

        if (msg.cron_expression && cron.validate(msg.cron_expression)) {
          const job = cron.schedule(msg.cron_expression, async () => {
            try {
              const channel = client.channels.cache.get(msg.channel_id);
              if (!channel) return;

              if (msg.embed_json) {
                const embedData = JSON.parse(msg.embed_json);
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder(embedData);
                await channel.send({ embeds: [embed] });
              } else if (msg.content) {
                await channel.send({ content: msg.content });
              }
              console.log(`[SCHEDULER] Mensagem agendada #${msg.id} enviada.`);
            } catch (err) {
              console.error(`[SCHEDULER] Erro ao enviar msg #${msg.id}:`, err.message);
            }
          });
          scheduledJobs.set(msg.id, job);
        }

        // One-shot messages
        if (msg.one_shot_at) {
          const sendAt = new Date(msg.one_shot_at);
          const delay = sendAt.getTime() - Date.now();
          if (delay > 0) {
            const timeout = setTimeout(async () => {
              try {
                const channel = client.channels.cache.get(msg.channel_id);
                if (!channel) return;

                if (msg.embed_json) {
                  const embedData = JSON.parse(msg.embed_json);
                  const { EmbedBuilder } = require('discord.js');
                  const embed = new EmbedBuilder(embedData);
                  await channel.send({ embeds: [embed] });
                } else if (msg.content) {
                  await channel.send({ content: msg.content });
                }

                // Desativar após envio
                const { deleteScheduledMessage } = require('./utils/database');
                deleteScheduledMessage(msg.id);
                scheduledJobs.delete(msg.id);
              } catch (err) {
                console.error(`[SCHEDULER] Erro one-shot #${msg.id}:`, err.message);
              }
            }, delay);
            scheduledJobs.set(msg.id, { stop: () => clearTimeout(timeout) });
          }
        }
      }
    } catch (err) {
      console.error('[SCHEDULER] Erro:', err.message);
    }
  }, 60000); // Recarregar a cada minuto
}

// --- MEMBER COUNT RECORDER (para gráficos de estatísticas) ---
function startMemberCountRecorder() {
  // Registar imediatamente ao iniciar
  recordAllGuildMemberCounts();

  // Depois a cada hora
  setInterval(() => {
    recordAllGuildMemberCounts();
  }, 60 * 60 * 1000);
}

function recordAllGuildMemberCounts() {
  try {
    client.guilds.cache.forEach(guild => {
      recordMemberCount(guild.id, guild.memberCount);
    });
  } catch (err) {
    console.error('[STATS] Erro ao registar contagem de membros:', err.message);
  }
}

// Iniciar Servidor Web
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 Web UI iniciada com sucesso!`);
  console.log(`🌐 Acede ao painel em: http://localhost:${PORT}`);
  console.log(`==================================================`);

  // Iniciar o Bot de Discord
  initBot();
});
