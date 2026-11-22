const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'data.db');
const OLD_DB_PATH = path.join(__dirname, '../../data.db');

// Assegurar que a pasta data existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Migrar o data.db antigo para a nova pasta se necessário
if (fs.existsSync(OLD_DB_PATH) && !fs.existsSync(DB_PATH)) {
  fs.renameSync(OLD_DB_PATH, DB_PATH);
}

let db = null;
let initPromise = null;
let shuttingDown = false;
let SQLModule = null; // guardado para validar buffers sem tocar na ligação ativa

async function getDb() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const SQL = await initSqlJs();
    SQLModule = SQL;
    let fileBuffer = null;
    if (fs.existsSync(DB_PATH)) {
      fileBuffer = fs.readFileSync(DB_PATH);
    }
    db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
    initTables();
    return db;
  })();

  return initPromise;
}

// Valida um binário de base de dados (ex: backup a restaurar) sem abrir mão da
// ligação em memória. Devolve { ok, error }.
function validateDbBuffer(buffer) {
  if (!SQLModule) return { ok: false, error: 'Base de dados ainda não inicializada.' };
  let probe = null;
  try {
    probe = new SQLModule.Database(buffer);
    const check = probe.exec('PRAGMA integrity_check');
    const verdict = check[0] && check[0].values[0] ? String(check[0].values[0][0]) : 'desconhecido';
    if (verdict !== 'ok') return { ok: false, error: `Verificação de integridade falhou: ${verdict}` };
    const tables = probe.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const names = new Set(tables[0] ? tables[0].values.map(v => v[0]) : []);
    for (const required of ['xp_levels', 'giveaways', 'warnings']) {
      if (!names.has(required)) return { ok: false, error: `Backup sem a tabela obrigatória "${required}".` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (probe) {
      try { probe.close(); } catch (err) { /* no-op */ }
    }
  }
}

function saveDb() {
  if (!db || shuttingDown) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function shutdownDb() {
  shuttingDown = true;
}

// Anula um shutdown: sem isto, uma operação que falhe depois de shutdownDb deixa
// o processo "vivo" mas a gravar nada em disco, silenciosamente.
function abortShutdown() {
  shuttingDown = false;
}

// Auto-save a cada 30 segundos (apenas após o DB estar carregado)
setInterval(() => { if (db) saveDb(); }, 30000);

// Gravar DB ao fechar gracefully
process.on('SIGINT', () => { saveDb(); process.exit(0); });
process.on('SIGTERM', () => { saveDb(); process.exit(0); });

function initTables() {
  if (!db) return;

  db.run(`CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT DEFAULT 'Sem razão especificada',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS xp_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    last_xp_at TEXT,
    UNIQUE(guild_id, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    prize TEXT NOT NULL,
    winners_count INTEGER DEFAULT 1,
    host_id TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    ended INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migração: as bases antigas não têm a coluna dos vencedores. Perguntar antes
  // de ALTERar: engolir o erro do ALTER deixaria uma coluna em falta a passar
  // por "já existia" (e os vencedores a desaparecer em silêncio).
  const gwCols = db.exec("PRAGMA table_info(giveaways)");
  const hasWinners = gwCols[0] ? gwCols[0].values.some(v => v[1] === 'winners') : false;
  if (!hasWinners) {
    try {
      db.run('ALTER TABLE giveaways ADD COLUMN winners TEXT');
      console.log('[DB] Coluna "winners" adicionada à tabela giveaways.');
    } catch (err) {
      console.error('[DB] Não foi possível adicionar a coluna "winners":', err.message);
    }
  }

  db.run(`CREATE TABLE IF NOT EXISTS giveaway_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    UNIQUE(giveaway_id, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    content TEXT,
    embed_json TEXT,
    cron_expression TEXT,
    one_shot_at TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS message_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    hour INTEGER NOT NULL,
    day TEXT NOT NULL,
    count INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS member_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    member_count INTEGER NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
  )`);

  // A consulta do gráfico filtra por (guild_id, recorded_at)
  db.run('CREATE INDEX IF NOT EXISTS idx_member_history_guild_time ON member_history(guild_id, recorded_at)');

  saveDb();
}

// Helper para queries
function queryAll(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('[DB] queryAll error:', e.message);
    return [];
  }
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function runSql(sql, params = []) {
  if (!db) return null;
  try {
    db.run(sql, params);
    // db.export() (dentro de saveDb) repõe o estado da ligação, por isso as
    // métricas têem de ser lidas ANTES de gravar em disco
    const result = { changes: db.getRowsModified(), lastId: queryOne('SELECT last_insert_rowid() as id')?.id };
    saveDb();
    return result;
  } catch (e) {
    console.error('[DB] run error:', e.message);
    return null;
  }
}

// --- WARNINGS ---
function addWarning(guildId, userId, moderatorId, reason) {
  return runSql('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)', [guildId, userId, moderatorId, reason || 'Sem razão especificada']);
}

function getWarnings(guildId, userId) {
  return queryAll('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC', [guildId, userId]);
}

function clearWarnings(guildId, userId) {
  return runSql('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

function getAllWarnings(guildId) {
  return queryAll('SELECT * FROM warnings WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100', [guildId]);
}

// --- XP / LEVELS ---
function calculateLevel(xp) {
  return Math.floor(0.1 * Math.sqrt(xp));
}

function xpForLevel(level) {
  return Math.pow(level / 0.1, 2);
}

function addXp(guildId, userId, amount) {
  const existing = queryOne('SELECT * FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  if (!existing) {
    // O primeiro ganho também pode cruzar níveis — calcular em vez de gravar 0
    const firstLevel = calculateLevel(amount);
    runSql('INSERT INTO xp_levels (guild_id, user_id, xp, level, total_messages, last_xp_at) VALUES (?, ?, ?, ?, 1, datetime(\'now\'))', [guildId, userId, amount, firstLevel]);
    return { xp: amount, level: firstLevel, leveledUp: firstLevel > 0 };
  }

  const newXp = existing.xp + amount;
  const newLevel = calculateLevel(newXp);
  const leveledUp = newLevel > existing.level;

  runSql('UPDATE xp_levels SET xp = ?, level = ?, total_messages = total_messages + 1, last_xp_at = datetime(\'now\') WHERE guild_id = ? AND user_id = ?', [newXp, newLevel, guildId, userId]);

  return { xp: newXp, level: newLevel, leveledUp, previousLevel: existing.level };
}

// XP de voz: não conta como mensagem nem consome o cooldown de XP por mensagem
function addVoiceXp(guildId, userId, amount) {
  const existing = queryOne('SELECT * FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  if (!existing) {
    const firstLevel = calculateLevel(amount);
    runSql('INSERT INTO xp_levels (guild_id, user_id, xp, level, total_messages) VALUES (?, ?, ?, ?, 0)', [guildId, userId, amount, firstLevel]);
    return { xp: amount, level: firstLevel, leveledUp: firstLevel > 0 };
  }

  const newXp = existing.xp + amount;
  const newLevel = calculateLevel(newXp);

  runSql('UPDATE xp_levels SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?', [newXp, newLevel, guildId, userId]);

  return { xp: newXp, level: newLevel, leveledUp: newLevel > existing.level, previousLevel: existing.level };
}

function getUserXp(guildId, userId) {
  return queryOne('SELECT * FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]) || { xp: 0, level: 0, total_messages: 0 };
}

function getLeaderboard(guildId, limit = 10) {
  return queryAll('SELECT * FROM xp_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?', [guildId, limit]);
}

function canGainXp(guildId, userId, cooldownSeconds = 60) {
  const row = queryOne('SELECT last_xp_at FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  if (!row || !row.last_xp_at) return true;
  const lastXp = new Date(row.last_xp_at + 'Z').getTime();
  return (Date.now() - lastXp) > (cooldownSeconds * 1000);
}

// --- TICKETS ---
function createTicket(guildId, channelId, userId) {
  return runSql('INSERT INTO tickets (guild_id, channel_id, user_id) VALUES (?, ?, ?)', [guildId, channelId, userId]);
}

function closeTicket(channelId) {
  return runSql('UPDATE tickets SET status = \'closed\', closed_at = datetime(\'now\') WHERE channel_id = ? AND status = \'open\'', [channelId]);
}

function getOpenTickets(guildId) {
  return queryAll('SELECT * FROM tickets WHERE guild_id = ? AND status = \'open\' ORDER BY created_at DESC', [guildId]);
}

function getUserOpenTicket(guildId, userId) {
  return queryOne('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = \'open\'', [guildId, userId]);
}

// --- GIVEAWAYS ---
function createGiveaway(guildId, channelId, messageId, prize, winnersCount, hostId, endsAt) {
  return runSql('INSERT INTO giveaways (guild_id, channel_id, message_id, prize, winners_count, host_id, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [guildId, channelId, messageId, prize, winnersCount, hostId, endsAt]);
}

function enterGiveaway(giveawayId, userId) {
  // runSql engole erros, por isso verificamos a entrada duplicada à partida
  const existing = queryOne('SELECT id FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', [giveawayId, userId]);
  if (existing) return false;
  const result = runSql('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)', [giveawayId, userId]);
  return !!result;
}

function getGiveawayEntries(giveawayId) {
  return queryAll('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', [giveawayId]);
}

function getActiveGiveaways() {
  return queryAll('SELECT * FROM giveaways WHERE ended = 0');
}

function endGiveaway(giveawayId, winners) {
  // Persiste vencedores junto do encerramento: se o anúncio falhar, o resultado
  // existe em BD e pode ser reenviado/recolocado sem voltar a sortear
  const list = Array.isArray(winners) ? winners.join(',') : (winners || '');
  return runSql('UPDATE giveaways SET ended = 1, winners = ? WHERE id = ?', [list, giveawayId]);
}

function getGiveawayByMessage(messageId) {
  return queryOne('SELECT * FROM giveaways WHERE message_id = ?', [messageId]);
}

function getGuildGiveaways(guildId) {
  return queryAll('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50', [guildId]);
}

// --- SCHEDULED MESSAGES ---
function addScheduledMessage(guildId, channelId, content, embedJson, cronExpression, oneShotAt) {
  return runSql('INSERT INTO scheduled_messages (guild_id, channel_id, content, embed_json, cron_expression, one_shot_at) VALUES (?, ?, ?, ?, ?, ?)', [guildId, channelId, content, embedJson, cronExpression, oneShotAt]);
}

function getScheduledMessages(guildId) {
  return queryAll('SELECT * FROM scheduled_messages WHERE guild_id = ? AND enabled = 1 ORDER BY created_at DESC', [guildId]);
}

function getAllScheduledMessages() {
  return queryAll('SELECT * FROM scheduled_messages WHERE enabled = 1');
}

function deleteScheduledMessage(id) {
  return runSql('DELETE FROM scheduled_messages WHERE id = ?', [id]);
}

// --- STATS ---
function recordMessageStat(guildId, channelId, userId) {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.toISOString().split('T')[0];

  const existing = queryOne('SELECT id, count FROM message_stats WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND hour = ? AND day = ?', [guildId, channelId, userId, hour, day]);

  if (existing) {
    runSql('UPDATE message_stats SET count = count + 1 WHERE id = ?', [existing.id]);
  } else {
    runSql('INSERT INTO message_stats (guild_id, channel_id, user_id, hour, day) VALUES (?, ?, ?, ?, ?)', [guildId, channelId, userId, hour, day]);
  }
}

function getMessageStatsByHour(guildId, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return queryAll('SELECT hour, SUM(count) as total FROM message_stats WHERE guild_id = ? AND day >= ? GROUP BY hour ORDER BY hour', [guildId, since]);
}

function getTopChannels(guildId, days = 7, limit = 10) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return queryAll('SELECT channel_id, SUM(count) as total FROM message_stats WHERE guild_id = ? AND day >= ? GROUP BY channel_id ORDER BY total DESC LIMIT ?', [guildId, since, limit]);
}

function getMessageStatsPerDay(guildId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return queryAll('SELECT day, SUM(count) as total FROM message_stats WHERE guild_id = ? AND day >= ? GROUP BY day ORDER BY day', [guildId, since]);
}

function recordMemberCount(guildId, count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return null; // evita pontos falsos durante estados transitórios
  return runSql('INSERT INTO member_history (guild_id, member_count) VALUES (?, ?)', [guildId, value]);
}

function getMemberHistory(guildId, days = 30) {
  // recorded_at é gravado por SQLite como 'YYYY-MM-DD HH:MM:SS', por isso o
  // limite tem de ser comparado no mesmo formato (não em ISO 8601 com 'T'/'Z')
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
  // Um ponto por dia: a ÚLTIMA amostra desse dia (o máximo do dia faria o
  // gráfico subir sempre para o pico e esconder perdas de membros).
  // NOTA de desempenho: tem de ser o IN (SELECT MAX(id) ... GROUP BY) — a versão
  // com subquery correlacionada sobre DATE() demorou 14s (medido com sql.js) para
  // um ano de amostras horárias de um só servidor, e o sql.js é síncrono.
  return queryAll(`SELECT DATE(recorded_at) as recorded_at, member_count FROM member_history
    WHERE guild_id = ? AND recorded_at >= ?
      AND id IN (SELECT MAX(id) FROM member_history WHERE guild_id = ? AND recorded_at >= ? GROUP BY DATE(recorded_at))
    ORDER BY recorded_at`, [guildId, since, guildId, since]);
}

// Disponível para limpeza manual (não é chamada automaticamente: apagar
// histórico é uma política que tem de ser decidida pelo administrador)
function pruneMemberHistory(days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
  return runSql('DELETE FROM member_history WHERE recorded_at < ?', [since]);
}

module.exports = {
  getDb, saveDb, shutdownDb, abortShutdown, validateDbBuffer, initTables,
  addWarning, getWarnings, clearWarnings, getAllWarnings,
  addXp, addVoiceXp, calculateLevel, xpForLevel, getUserXp, getLeaderboard, canGainXp,
  createTicket, closeTicket, getOpenTickets, getUserOpenTicket,
  createGiveaway, enterGiveaway, getGiveawayEntries, getActiveGiveaways, endGiveaway, getGiveawayByMessage, getGuildGiveaways,
  addScheduledMessage, getScheduledMessages, getAllScheduledMessages, deleteScheduledMessage,
  recordMessageStat, getMessageStatsByHour, getTopChannels, getMessageStatsPerDay,
  recordMemberCount, getMemberHistory, pruneMemberHistory
};
