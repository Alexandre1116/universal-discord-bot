const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
// Permitir apontar a BD para outro ficheiro: é assim que `npm run verify` corre
// numa cópia temporária em vez de escrever na base de dados real.
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'data.db');
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

// Esquema mínimo que o código espera encontrar. Nomes de tabelas não chegam:
// uma BD com as tabelas certas mas colunas em falta passaria no integrity_check e
// rebentava nas consultas do bot depois da troca. As colunas que o arranque sabe
// migrar (winners) são toleradas em falta.
const REQUIRED_SCHEMA = {
  xp_levels: ['guild_id', 'user_id', 'xp', 'level'],
  warnings: ['guild_id', 'user_id'],
  giveaways: ['guild_id', 'channel_id', 'prize', 'ends_at'],
  tickets: ['guild_id', 'channel_id', 'user_id', 'status'],
  member_history: ['guild_id', 'member_count', 'recorded_at']
};

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

    for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
      const info = probe.exec(`PRAGMA table_info(${table})`);
      if (!info[0]) return { ok: false, error: `Backup sem a tabela obrigatória "${table}".` };
      const present = new Set(info[0].values.map(v => v[1]));
      const missing = columns.filter(c => !present.has(c));
      if (missing.length) {
        return { ok: false, error: `A tabela "${table}" do backup não tem as colunas: ${missing.join(', ')}.` };
      }
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

// O sql.js não escreve em incremental: saveDb() exporta a BD inteira. Estatísticas
// de mensagens e XP acontecem a cada mensagem, e medir isso deu ~10 ms por escrita
// com 1,7 MB de base de dados — tempo demasiado a bloquear o loop de eventos.
// Essas escritas ficam em memória e vão para disco agrupadas, no máximo uma vez
// por WRITE_BEHIND_MS. O autosave de 30 s e o fecho limpo continuam a garantir
// o resto.
let flushTimer = null;
const WRITE_BEHIND_MS = 2000;

function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  saveDb();
}

function scheduleSave() {
  if (!db || shuttingDown || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      saveDb();
    } catch (err) {
      console.error('[DB] gravação em atraso falhou (o autosave de 30 s tenta de novo):', err.message);
    }
  }, WRITE_BEHIND_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
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
setInterval(() => { if (db) flushNow(); }, 30000);

// Gravar DB ao fechar gracefully
process.on('SIGINT', () => { flushNow(); process.exit(0); });
process.on('SIGTERM', () => { flushNow(); process.exit(0); });

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
    winners TEXT,
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

// opts.delay = true → a alteração fica em memória e vai para disco no próximo
// flush agrupado (até WRITE_BEHIND_MS). Usado só nas escritas de estatísticas e
// XP, que acontecem a cada mensagem. persisted vale:
//   true  → já está em disco
//   false → ficou só em memória (a gravação em disco falhou)
//   null  → fica em fila, será gravada no próximo flush
function runSql(sql, params = [], opts = {}) {
  if (!db) return null;
  // Durante um restauro as escritas são recusadas ANTES de alterarem a memória:
  // caso contrário o processo parece responder sucesso e perde a operação
  if (shuttingDown) {
    console.error('[DB] Escritas suspensas (restauro em curso); operação recusada.');
    return null;
  }
  let result;
  try {
    db.run(sql, params);
    // db.export() (dentro de saveDb) repõe o estado da ligação, por isso as
    // métricas têem de ser lidas ANTES de gravar em disco
    result = { changes: db.getRowsModified(), lastId: queryOne('SELECT last_insert_rowid() as id')?.id, persisted: true };
  } catch (e) {
    console.error('[DB] run error:', e.message);
    return null;
  }
  if (opts.delay) {
    result.persisted = null;
    scheduleSave();
    return result;
  }
  try {
    saveDb();
  } catch (e) {
    // A alteração ficou aplicada em memória (o autosave de 30s tenta de novo);
    // o importante é não dizer que falhou quando não falhou, nem que persistiu
    // quando não persistiu
    console.error('[DB] alteração aplicada em memória mas não gravada em disco:', e.message);
    result.persisted = false;
  }
  return result;
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
    runSql('INSERT INTO xp_levels (guild_id, user_id, xp, level, total_messages, last_xp_at) VALUES (?, ?, ?, ?, 1, datetime(\'now\'))', [guildId, userId, amount, firstLevel], { delay: true });
    return { xp: amount, level: firstLevel, leveledUp: firstLevel > 0 };
  }

  const newXp = existing.xp + amount;
  const newLevel = calculateLevel(newXp);
  const leveledUp = newLevel > existing.level;

  runSql('UPDATE xp_levels SET xp = ?, level = ?, total_messages = total_messages + 1, last_xp_at = datetime(\'now\') WHERE guild_id = ? AND user_id = ?', [newXp, newLevel, guildId, userId], { delay: true });

  return { xp: newXp, level: newLevel, leveledUp, previousLevel: existing.level };
}

// XP de voz: não conta como mensagem nem consome o cooldown de XP por mensagem
function addVoiceXp(guildId, userId, amount) {
  const existing = queryOne('SELECT * FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]);

  if (!existing) {
    const firstLevel = calculateLevel(amount);
    runSql('INSERT INTO xp_levels (guild_id, user_id, xp, level, total_messages) VALUES (?, ?, ?, ?, 0)', [guildId, userId, amount, firstLevel], { delay: true });
    return { xp: amount, level: firstLevel, leveledUp: firstLevel > 0 };
  }

  const newXp = existing.xp + amount;
  const newLevel = calculateLevel(newXp);

  runSql('UPDATE xp_levels SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?', [newXp, newLevel, guildId, userId], { delay: true });

  return { xp: newXp, level: newLevel, leveledUp: newLevel > existing.level, previousLevel: existing.level };
}

function getUserXp(guildId, userId) {
  return queryOne('SELECT * FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]) || { xp: 0, level: 0, total_messages: 0 };
}

function getLeaderboard(guildId, limit = 10) {
  return queryAll('SELECT * FROM xp_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?', [guildId, limit]);
}

// As datas gravadas podem vir em ISO 8601 (com 'Z' ou desvio) ou no formato de
// texto do SQLite ('YYYY-MM-DD HH:MM:SS', sem fuso). Juntar sempre 'Z' rebentava
// o parse (NaN) — e um NaN no cooldown de XP bloqueava o ganho de XP para
// sempre. Um único parser para todo o código: devolve Date ou null.
function parseDbDate(value) {
  if (!value) return null;
  let str = String(value).trim();
  if (!/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) str += 'Z';
  str = str.replace(' ', 'T');
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canGainXp(guildId, userId, cooldownSeconds = 60) {
  const row = queryOne('SELECT last_xp_at FROM xp_levels WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  if (!row || !row.last_xp_at) return true;
  const lastXp = parseDbDate(row.last_xp_at);
  if (!lastXp) return true; // data ilegível: não pode bloquear o ganho para sempre
  return (Date.now() - lastXp.getTime()) > (cooldownSeconds * 1000);
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
  if (result) return true;
  // Sem resultado: ou foi corrida com outro clique (UNIQUE) ou a escrita falhou.
  // Reler distingue as duas — dizer "já participas" numa avaria da BD faria a
  // pessoa desistir de uma participação que nunca chegou a existir.
  const raced = queryOne('SELECT id FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?', [giveawayId, userId]);
  return raced ? false : null;
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
    runSql('UPDATE message_stats SET count = count + 1 WHERE id = ?', [existing.id], { delay: true });
  } else {
    runSql('INSERT INTO message_stats (guild_id, channel_id, user_id, hour, day) VALUES (?, ?, ?, ?, ?)', [guildId, channelId, userId, hour, day], { delay: true });
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
  return runSql('INSERT INTO member_history (guild_id, member_count) VALUES (?, ?)', [guildId, value], { delay: true });
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
  getDb, saveDb, flushNow, shutdownDb, abortShutdown, validateDbBuffer, initTables, parseDbDate,
  addWarning, getWarnings, clearWarnings, getAllWarnings,
  addXp, addVoiceXp, calculateLevel, xpForLevel, getUserXp, getLeaderboard, canGainXp,
  createTicket, closeTicket, getOpenTickets, getUserOpenTicket,
  createGiveaway, enterGiveaway, getGiveawayEntries, getActiveGiveaways, endGiveaway, getGiveawayByMessage, getGuildGiveaways,
  addScheduledMessage, getScheduledMessages, getAllScheduledMessages, deleteScheduledMessage,
  recordMessageStat, getMessageStatsByHour, getTopChannels, getMessageStatsPerDay,
  recordMemberCount, getMemberHistory, pruneMemberHistory
};
