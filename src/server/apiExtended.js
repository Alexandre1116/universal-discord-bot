const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getConfig, updateConfig } = require('../utils/config');
const { client } = require('../bot/client');
const {
  getAllWarnings, getLeaderboard,
  getMessageStatsByHour, getTopChannels, getMessageStatsPerDay, getMemberHistory,
  getOpenTickets, getGuildGiveaways,
  addScheduledMessage, getScheduledMessages, deleteScheduledMessage,
} = require('../utils/database');

const router = express.Router();

// Confirma a gravação em disco em vez de assumir sucesso (updateConfig devolve
// null quando saveConfig falha)
function savedOr500(res, saved, payload = { success: true }) {
  if (!saved) {
    return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
  }
  return res.json(payload);
}

// ================================
// MODERAÇÃO — Configuração de Auto-Mod
// ================================

// GET /api/moderation
router.get('/moderation', (req, res) => {
  const config = getConfig();
  res.json(config.moderation || {
    enabled: false,
    antiSpam: false,
    antiLinks: false,
    antiCaps: false,
    bannedWords: [],
    linkAllowedChannels: [],
    maxStrikes: 3,
    strikeAction: 'mute'
  });
});

// POST /api/moderation
router.post('/moderation', (req, res) => {
  const updates = req.body;
  const config = getConfig();
  savedOr500(res, updateConfig({ moderation: { ...(config.moderation || {}), ...updates } }));
});

// GET /api/warnings/:guildId
router.get('/warnings/:guildId', (req, res) => {
  const warnings = getAllWarnings(req.params.guildId);
  res.json(warnings);
});

// ================================
// AUDIT LOG — Configuração
// ================================

// GET /api/audit-log
router.get('/audit-log', (req, res) => {
  const config = getConfig();
  res.json(config.auditLog || {
    enabled: false,
    channelId: '',
    messageDelete: true,
    messageEdit: true,
    bans: true,
    voiceJoinLeave: true
  });
});

// POST /api/audit-log
router.post('/audit-log', (req, res) => {
  const updates = req.body;
  const config = getConfig();
  savedOr500(res, updateConfig({ auditLog: { ...(config.auditLog || {}), ...updates } }));
});

// ================================
// TICKETS — Configuração
// ================================

// GET /api/tickets/config
router.get('/tickets/config', (req, res) => {
  const config = getConfig();
  res.json(config.tickets || {
    supportRoleId: '',
    categoryId: '',
    logChannelId: ''
  });
});

// POST /api/tickets/config
router.post('/tickets/config', (req, res) => {
  const config = getConfig();
  savedOr500(res, updateConfig({ tickets: { ...(config.tickets || {}), ...req.body } }));
});

// GET /api/tickets/open/:guildId
router.get('/tickets/open/:guildId', (req, res) => {
  const tickets = getOpenTickets(req.params.guildId);
  res.json(tickets);
});

// ================================
// REACTION ROLES
// ================================

// GET /api/reaction-roles
router.get('/reaction-roles', (req, res) => {
  const config = getConfig();
  res.json(config.reactionRoles || []);
});

// POST /api/reaction-roles — Criar/enviar painel de Reaction Roles
router.post('/reaction-roles', async (req, res) => {
  try {
    const { channelId, title, description, color, roles } = req.body;

    if (!channelId || !roles || roles.length === 0) {
      return res.status(400).json({ success: false, error: 'Canal e pelo menos um cargo são obrigatórios.' });
    }

    const channel = client.channels.cache.get(channelId) ||
      await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ success: false, error: 'Canal não encontrado.' });
    }

    // Construir embed
    const roleDescriptions = roles.map(r => `${r.emoji || '🔘'} — <@&${r.roleId}>${r.description ? ` — ${r.description}` : ''}`);
    const embed = new EmbedBuilder()
      .setTitle(title || '🎭 Seleciona os teus Cargos')
      .setDescription((description || 'Clica nos botões abaixo para receber ou remover cargos!') + '\n\n' + roleDescriptions.join('\n'))
      .setColor(color || '#5865F2')
      .setTimestamp();

    // Construir botões (máximo 5 por row, 5 rows = 25 botões)
    const rows = [];
    for (let i = 0; i < roles.length; i += 5) {
      const row = new ActionRowBuilder();
      const chunk = roles.slice(i, i + 5);
      chunk.forEach(r => {
        const btn = new ButtonBuilder()
          .setCustomId(`rr_${r.roleId}`)
          .setLabel(r.label || r.roleId)
          .setStyle(ButtonStyle.Secondary);
        if (r.emoji) btn.setEmoji(r.emoji);
        row.addComponents(btn);
      });
      rows.push(row);
    }

    const msg = await channel.send({ embeds: [embed], components: rows });

    // Guardar na config
    const config = getConfig();
    const reactionRoles = config.reactionRoles || [];
    reactionRoles.push({
      id: `rr_${Date.now()}`,
      channelId,
      messageId: msg.id,
      title: title || 'Reaction Roles',
      roles,
      createdAt: new Date().toISOString()
    });
    savedOr500(res, updateConfig({ reactionRoles }), { success: true, messageId: msg.id });
  } catch (err) {
    console.error('[RR] Erro ao criar reaction roles:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/reaction-roles/:id
router.delete('/reaction-roles/:id', (req, res) => {
  const config = getConfig();
  let reactionRoles = config.reactionRoles || [];
  reactionRoles = reactionRoles.filter(rr => rr.id !== req.params.id);
  savedOr500(res, updateConfig({ reactionRoles }));
});

// ================================
// NÍVEIS / XP — Configuração
// ================================

// GET /api/levels/config
router.get('/levels/config', (req, res) => {
  const config = getConfig();
  res.json(config.levels || {
    enabled: false,
    minXp: 15,
    maxXp: 25,
    xpCooldown: 60,
    announceChannelId: '',
    roles: []
  });
});

// POST /api/levels/config
router.post('/levels/config', (req, res) => {
  const config = getConfig();
  savedOr500(res, updateConfig({ levels: { ...(config.levels || {}), ...req.body } }));
});

// GET /api/levels/leaderboard/:guildId
router.get('/levels/leaderboard/:guildId', (req, res) => {
  const leaderboard = getLeaderboard(req.params.guildId, 25);
  res.json(leaderboard);
});

// ================================
// EMBEDS CUSTOMIZADOS & AGENDADOS
// ================================

// POST /api/send-embed — Enviar embed personalizado imediatamente
router.post('/send-embed', async (req, res) => {
  try {
    const { channelId, title, description, color, footer, thumbnail, image } = req.body;

    if (!channelId) return res.status(400).json({ success: false, error: 'Canal obrigatório.' });

    const channel = client.channels.cache.get(channelId) ||
      await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ success: false, error: 'Canal não encontrado.' });
    }

    const embed = new EmbedBuilder()
      .setColor(color || '#5865F2')
      .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (footer) embed.setFooter({ text: footer });
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);

    await channel.send({ embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/scheduled-messages — Agendar mensagem
router.post('/scheduled-messages', (req, res) => {
  try {
    const { guildId, channelId, content, embedJson, cronExpression, oneShotAt } = req.body;
    if (!channelId) return res.status(400).json({ success: false, error: 'Canal obrigatório.' });

    addScheduledMessage(guildId, channelId, content, embedJson ? JSON.stringify(embedJson) : null, cronExpression, oneShotAt);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/scheduled-messages/:guildId
router.get('/scheduled-messages/:guildId', (req, res) => {
  const messages = getScheduledMessages(req.params.guildId);
  res.json(messages);
});

// DELETE /api/scheduled-messages/:id
router.delete('/scheduled-messages/:id', (req, res) => {
  deleteScheduledMessage(parseInt(req.params.id));
  res.json({ success: true });
});

// ================================
// GIVEAWAYS
// ================================

// GET /api/giveaways/:guildId
router.get('/giveaways/:guildId', (req, res) => {
  const giveaways = getGuildGiveaways(req.params.guildId);
  res.json(giveaways);
});

// ================================
// ESTATÍSTICAS
// ================================

// GET /api/stats/:guildId
router.get('/stats/:guildId', (req, res) => {
  const guildId = req.params.guildId;
  const days = parseInt(req.query.days) || 7;

  const hourly = getMessageStatsByHour(guildId, days);
  const topChannels = getTopChannels(guildId, days);
  const daily = getMessageStatsPerDay(guildId, 30);
  const memberHistory = getMemberHistory(guildId, 30);

  // Resolver nomes de canais
  const guild = client.guilds.cache.first();
  const topChannelsNamed = topChannels.map(tc => {
    const ch = guild?.channels.cache.get(tc.channel_id);
    return { ...tc, name: ch ? `#${ch.name}` : tc.channel_id };
  });

  res.json({
    hourly,
    topChannels: topChannelsNamed,
    daily,
    memberHistory
  });
});

// GET /api/logs
router.get('/logs', (req, res) => {
  const { getLogs } = require('../utils/logger');
  res.json(getLogs());
});

// ================================
// WEB UI SETTINGS (Password & Owners)
// ================================

// GET /api/web-settings
router.get('/web-settings', (req, res) => {
  const config = getConfig();
  res.json({
    botOwners: config.botOwners || []
  });
});

// POST /api/web-settings
router.post('/web-settings', (req, res) => {
  const config = getConfig();
  const updates = {};
  
  if (req.body.botOwners) {
    updates.botOwners = req.body.botOwners;
  }
  
  if (req.body.password && req.body.password.trim() !== '') {
    if (config.webAuth) {
      updates.webAuth = {
        username: config.webAuth.username,
        password: req.body.password.trim()
      };
    }
  }

  savedOr500(res, updateConfig(updates));
});

// ================================
// ROLES DO SERVIDOR (para dropdowns)
// ================================

// GET /api/roles
router.get('/roles', (req, res) => {
  const guild = client.guilds.cache.first();
  if (!guild) return res.json([]);

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

  res.json(roles);
});

// GET /api/categories
router.get('/categories', (req, res) => {
  const guild = client.guilds.cache.first();
  if (!guild) return res.json([]);

  const categories = guild.channels.cache
    .filter(c => c.type === 4) // CategoryChannel
    .map(c => ({ id: c.id, name: c.name }));

  res.json(categories);
});

// GET /api/backup
router.get('/backup', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = path.join(__dirname, '../../data');
  const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
  const DB_PATH = path.join(DATA_DIR, 'data.db');

  try {
    const backup = {
      config: fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : '{}',
      database: fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH).toString('base64') : ''
    };
    res.json(backup);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/restore
router.post('/restore', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { shutdownDb } = require('../utils/database');
  const { saveConfig } = require('../utils/config');
  const DATA_DIR = path.join(__dirname, '../../data');
  const DB_PATH = path.join(DATA_DIR, 'data.db');

  try {
    const { config, database } = req.body;

    // 1) VALIDAR ANTES de tocar em seja o que for: um backup partido não pode
    // deixar o painel sem credenciais nem a base de dados corrompida
    let parsedConfig = null;
    if (config !== undefined && config !== null && config !== '') {
      try {
        parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
      } catch (err) {
        throw new Error(`Backup inválido: "config" não é JSON (${err.message}).`);
      }
      if (typeof parsedConfig !== 'object' || parsedConfig === null || Array.isArray(parsedConfig)) {
        throw new Error('Backup inválido: "config" tem de ser um objeto JSON.');
      }
    }

    let dbBuffer = null;
    if (database) {
      dbBuffer = Buffer.from(String(database), 'base64');
      if (dbBuffer.length === 0) throw new Error('Backup inválido: a base de dados está vazia.');
      if (dbBuffer.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
        throw new Error('Backup inválido: a base de dados não é um ficheiro SQLite válido.');
      }
    }

    if (!parsedConfig && !dbBuffer) {
      return res.status(400).json({ success: false, error: 'Backup sem "config" nem "database" para restaurar.' });
    }

    // 2) O backup automático do Discord vem SEM segredos (token, credenciais do
    // painel, session secret): preservamos os atuais para o painel não ficar
    // inacessível depois de um restauro.
    if (parsedConfig) {
      const current = getConfig();
      if (!parsedConfig.token) parsedConfig.token = current.token;
      if (!parsedConfig.webAuth || !parsedConfig.webAuth.password) parsedConfig.webAuth = current.webAuth;
      if (!parsedConfig.sessionSecret) parsedConfig.sessionSecret = current.sessionSecret;
    }

    // 3) Só agora escrevemos. Primeiro o ficheiro novo da BD para um temporário
    // (falhar aqui não altera nada); depois o config; por fim fechamos a BD e
    // fazemos rename — assim não fica config novo com BD antiga/fechada.
    const tmpDb = `${DB_PATH}.restore`;
    if (dbBuffer) fs.writeFileSync(tmpDb, dbBuffer);

    try {
      if (parsedConfig && !saveConfig(parsedConfig)) {
        throw new Error('Falha ao gravar o config restaurado em disco.');
      }

      if (dbBuffer) {
        shutdownDb();
        fs.renameSync(tmpDb, DB_PATH);
      }
    } finally {
      if (dbBuffer && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    }

    res.json({ success: true, message: 'Restauro concluído! A reiniciar o sistema...' });

    setTimeout(() => {
      console.log('[SYSTEM] A reiniciar por pedido de restauro...');
      process.exit(0);
    }, 2000);

  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /api/commands/register
router.post('/commands/register', async (req, res) => {
  const { registerCommands } = require('../bot/commands/register');
  const config = getConfig();

  // Mesma resolução de credenciais usada no arranque (senão um DISCORD_TOKEN de
  // ambiente era ignorado e o registo falhava com o token do config)
  const clientId = process.env.CLIENT_ID || config.clientId || client.user?.id;
  const token = process.env.DISCORD_TOKEN || config.token;

  if (!client.user || !clientId || !token) {
    return res.status(400).json({ success: false, error: 'O bot não está online ou falta o token.' });
  }

  try {
    const result = await registerCommands(clientId, token);
    res.json({ success: true, message: `Comandos Slash registados com sucesso! (${result.registered})` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/custom-commands
router.get('/custom-commands', (req, res) => {
  const config = getConfig();
  res.json(config.customCommands || []);
});

// POST /api/custom-commands
router.post('/custom-commands', (req, res) => {
  const { commands } = req.body;
  if (!Array.isArray(commands)) {
    return res.status(400).json({ success: false, error: 'Formato inválido.' });
  }
  savedOr500(res, updateConfig({ customCommands: commands }), { success: true, message: 'Comandos atualizados.' });
});

// GET /api/notifications
router.get('/notifications', (req, res) => {
  const config = getConfig();
  const notifications = config.notifications || {};
  res.json({
    youtube: notifications.youtube || [],
    twitch: notifications.twitch || []
  });
});

// POST /api/notifications — faz merge para não apagar a plataforma que o UI não mostra
router.post('/notifications', (req, res) => {
  const config = getConfig();
  const current = config.notifications || {};
  const incoming = req.body || {};
  const saved = updateConfig({
    notifications: {
      ...current,
      ...(Array.isArray(incoming.youtube) ? { youtube: incoming.youtube } : {}),
      ...(Array.isArray(incoming.twitch) ? { twitch: incoming.twitch } : {})
    }
  });
  savedOr500(res, saved, { success: true, message: 'Notificações atualizadas.' });
});

// GET /api/modules
router.get('/modules', (req, res) => {
  const config = getConfig();
  res.json(config.modules || {});
});

// POST /api/modules
router.post('/modules', (req, res) => {
  const modules = req.body;
  savedOr500(res, updateConfig({ modules }), { success: true, message: 'Módulos atualizados com sucesso.' });
});

module.exports = router;
