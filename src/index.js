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
const registerMessageCreate = require('./bot/events/messageCreate');
const { client, initBot } = require('./bot/client');
const apiRoutes = require('./server/api');
const apiExtendedRoutes = require('./server/apiExtended');
const { authMiddleware, setupAuthRoutes } = require('./server/auth');
const { getDb } = require('./utils/database');
const { getConfig } = require('./utils/config');
const { loadPlugins } = require('./utils/pluginManager');
const { REST, Routes } = require('discord.js');

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

// Rotas API Core
app.use('/api', apiRoutes);
app.use('/api', apiExtendedRoutes);

// Registar Eventos do Bot Core
registerGuildMemberAdd(client);
registerGuildMemberRemove(client);
registerMessageCreate(client);

// Carregar Plugins
const pluginCommands = loadPlugins(client, app);

// Rota genérica para servir a Web UI (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Quando o bot está pronto, registar slash commands
client.once('ready', async () => {
  const clientId = process.env.CLIENT_ID || getConfig().clientId || client.user.id;
  const token = process.env.DISCORD_TOKEN || getConfig().token;

  if (clientId && token) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      const commandJSONs = pluginCommands.map(c => c.toJSON ? c.toJSON() : c);
      console.log(`[COMMANDS] A registar ${commandJSONs.length} slash commands de plugins...`);
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commandJSONs }
      );
      console.log(`[COMMANDS] Slash commands registados com sucesso!`);
    } catch (error) {
      console.error('[COMMANDS] Erro ao registar slash commands:', error);
    }
  }

  // Inicializar base de dados
  await getDb();
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
