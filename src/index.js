require('dotenv').config();
require('./utils/logger'); // Inicia a interceção de logs
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const registerGuildMemberAdd = require('./bot/events/guildMemberAdd');
const registerGuildMemberRemove = require('./bot/events/guildMemberRemove');
const registerMessageCreate = require('./bot/events/messageCreate');
const { client, initBot } = require('./bot/client');
const apiRoutes = require('./server/api');
const apiExtendedRoutes = require('./server/apiExtended');
const { authMiddleware, setupAuthRoutes } = require('./server/auth');
const { getDb, recordMemberCount, pruneMemberHistory } = require('./utils/database');
const { getConfig, updateConfig } = require('./utils/config');
const { loadPlugins } = require('./utils/pluginManager');
const { startScheduledMessages } = require('./bot/services/scheduledMessages');
const { REST, Routes, Events } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares de segurança
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());

// Rate limiting para a API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: 'Muitos pedidos. Tenta novamente mais tarde.' }
});
app.use('/api/', apiLimiter);

// Rate limiting específico para login (prevenir brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Demasiadas tentativas de login. Tenta novamente mais tarde.' }
});

app.use(bodyParser.json());
// Garantir session secret persistente
const sessionSecret = process.env.SESSION_SECRET || (() => {
  const config = getConfig();
  if (config.sessionSecret) return config.sessionSecret;
  const crypto = require('crypto');
  const newSecret = crypto.randomBytes(32).toString('hex');
  updateConfig({ sessionSecret: newSecret });
  return newSecret;
})();

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Servir ficheiros estáticos
app.use(express.static(path.join(__dirname, '../public')));

// Auth routes (antes do middleware)
setupAuthRoutes(app, loginLimiter);

// Auth middleware para proteger API (se OAuth ativo)
app.use('/api', authMiddleware);

// Health check endpoint (antes das rotas protegidas)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Rotas API Core
app.use('/api', apiRoutes);
app.use('/api', apiExtendedRoutes);

// Router onde os plugins instalam as suas rotas HTTP (registrado antes do
// fallback 404 para que rotas adicionadas em tempo de execução funcionem)
const pluginRouter = express.Router();
app.use(pluginRouter);

// Rotas de API desconhecidas devolvem JSON (em vez do HTML da SPA)
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Rota da API não encontrada: ${req.method} ${req.originalUrl}` });
});

// Registar Eventos do Bot Core
registerGuildMemberAdd(client);
registerGuildMemberRemove(client);
registerMessageCreate(client);

// Inicializar base de dados de forma assíncrona
getDb().catch(err => console.error('[DB] Erro ao inicializar base de dados:', err));

// Carregar Plugins apenas quando o bot estiver pronto
let pluginCommands = [];
client.once(Events.ClientReady, async () => {
  // Garantir que a base de dados está pronta antes de carregar plugins
  try {
    await getDb();
  } catch (err) {
    console.error('[DB] Erro ao inicializar base de dados:', err);
  }

  // Carregar plugins dentro do ready para garantir que client.user está disponível
  try {
    pluginCommands = loadPlugins(client, pluginRouter);
  } catch (err) {
    console.error('[PLUGINS] Erro ao carregar plugins:', err);
  }

  // Iniciar agendador de mensagens programadas
  try {
    startScheduledMessages(client);
  } catch (err) {
    console.error('[SCHEDULER] Erro ao iniciar agendador de mensagens:', err);
  }

  // Instantâneos do número de membros (alimenta o gráfico de crescimento da Web UI)
  try {
    const snapshotMembers = () => {
      for (const guild of client.guilds.cache.values()) {
        recordMemberCount(guild.id, guild.memberCount);
      }
      pruneMemberHistory(90);
    };
    snapshotMembers();
    cron.schedule('0 * * * *', snapshotMembers); // a cada hora
    console.log('[STATS] Instantâneos de membros ativos (1x por hora).');
  } catch (err) {
    console.error('[STATS] Erro ao iniciar instantâneos de membros:', err);
  }

  // Registarr slash commands
  const clientId = process.env.CLIENT_ID || getConfig().clientId || client.user.id;
  const token = process.env.DISCORD_TOKEN || getConfig().token;

  if (clientId && token) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      const commandJSONs = pluginCommands.map(c => c.toJSON ? c.toJSON() : c);
      if (commandJSONs.length === 0) {
        console.warn('[COMMANDS] Nenhum comando de plugin ativo — nenhum comando registado no Discord.');
      } else {
        console.log(`[COMMANDS] A registar ${commandJSONs.length} slash commands de plugins...`);
        await rest.put(
          Routes.applicationCommands(clientId),
          { body: commandJSONs }
        );
        console.log(`[COMMANDS] Slash commands registados com sucesso!`);
      }
    } catch (error) {
      console.error('[COMMANDS] Erro ao registar slash commands:', error);
    }
  } else {
    console.warn('[COMMANDS] CLIENT_ID ou DISCORD_TOKEN ausentes — slash commands não registados.');
  }
});

// Rota genérica para servir a Web UI (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Iniciar Servidor Web
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 Web UI iniciada com sucesso!`);
  console.log(`🌐 Acede ao painel em: http://localhost:${PORT}`);
  console.log(`==================================================`);

  // Iniciar o Bot de Discord
  initBot();
});
