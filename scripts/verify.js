/*
 * Verificação automática do estado funcional do bot (plugins, comandos, base de
 * dados, contratos Web UI ↔ API ↔ plugins e regras de segurança).
 *
 *   npm run verify
 *
 * AVISO: corre com o client real de discord.js (sem login) e USA A BASE DE DADOS
 * REAL em data/data.db (apaga linhas de testes nas tabelas que toca). Corre num
 * checkout limpo ou com uma cópia de segurança. Não toca em data/config.json.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const results = [];
  const rec = (name, ok, info = '') => results.push({ name, ok, info });
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

  // ---------- Base de dados ----------
  const db = require(path.join(ROOT, 'src/utils/database.js'));
  const sql = await db.getDb();
  sql.run('DELETE FROM warnings; DELETE FROM giveaway_entries; DELETE FROM giveaways; DELETE FROM xp_levels; DELETE FROM member_history;');

  db.addWarning('g1', 'u1', 'mod1', 'teste');
  db.addWarning('g1', 'u1', 'mod1', 'teste2');
  const warns = db.getWarnings('g1', 'u1');
  rec('warnings gravados/lidos', warns.length === 2, `total=${warns.length}`);

  const runMeta = db.addWarning('g1', 'u2', 'mod1', 'x');
  rec('runSql devolve changes/lastId/persisted', !!runMeta && runMeta.changes === 1 && runMeta.lastId > 0 && runMeta.persisted === true, JSON.stringify(runMeta));

  const big = db.addXp('g1', 'lvl1', 5000);
  const lvlRow = db.getUserXp('g1', 'lvl1');
  rec('addXp no 1º insert calcula o nível', big.level > 0 && big.leveledUp === true && lvlRow.level === big.level, JSON.stringify({ ret: big, row: { xp: lvlRow.xp, level: lvlRow.level } }));
  const bigVoice = db.addVoiceXp('g1', 'lvl2', 5000);
  rec('addVoiceXp no 1º insert calcula o nível', bigVoice.level > 0 && db.getUserXp('g1', 'lvl2').level === bigVoice.level, JSON.stringify(bigVoice));

  db.addXp('g1', 'voice1', 20);
  const beforeVoice = db.getUserXp('g1', 'voice1');
  db.addVoiceXp('g1', 'voice1', 30);
  const afterVoice = db.getUserXp('g1', 'voice1');
  rec('addVoiceXp soma XP sem contar mensagem', afterVoice.total_messages === beforeVoice.total_messages && afterVoice.xp === beforeVoice.xp + 30);
  rec('addVoiceXp não atualiza last_xp_at', afterVoice.last_xp_at === beforeVoice.last_xp_at, `${beforeVoice.last_xp_at} -> ${afterVoice.last_xp_at}`);

  const iso = new Date(Date.now() + 60000).toISOString();
  const sqliteStyle = new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' ');
  db.createGiveaway('g1', 'c1', 'm_new', 'prize', 1, 'host', iso);
  db.createGiveaway('g1', 'c2', 'm_old', 'prize old', 1, 'host', sqliteStyle);
  const actives = db.getActiveGiveaways();
  rec('giveaways ativos', actives.length === 2, `n=${actives.length}`);
  const e1 = db.enterGiveaway(actives[0].id, 'u1');
  const e2 = db.enterGiveaway(actives[0].id, 'u1');
  rec('entrada duplicada devolve false', e1 === true && e2 === false, `e1=${e1} e2=${e2}`);
  const endedRes = db.endGiveaway(actives[0].id, ['a1', 'a2']);
  const gwRow = sql.exec('SELECT ended, winners FROM giveaways WHERE id = ' + actives[0].id);
  const gwVals = gwRow[0] ? gwRow[0].values[0] : [];
  rec('endGiveaway grava ended + vencedores', !!endedRes && gwVals[0] === 1 && gwVals[1] === 'a1,a2', JSON.stringify(gwVals));

  sql.run('DELETE FROM member_history');
  db.recordMemberCount('g1', 10);
  db.recordMemberCount('g1', 12);
  db.recordMemberCount('g1', 11);
  db.recordMemberCount('g1', 0);
  sql.run('INSERT INTO member_history (guild_id, member_count, recorded_at) VALUES (?, ?, ?)', ['g1', 5, new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ')]);
  const hist30 = db.getMemberHistory('g1', 30);
  rec('histórico: última amostra do dia, ignora count<=0', hist30.length === 1 && hist30[0].member_count === 11, JSON.stringify(hist30));
  rec('histórico 90d inclui o antigo', db.getMemberHistory('g1', 90).length === 2, `n=${db.getMemberHistory('g1', 90).length}`);

  // amostras suficientes para a query não voltar a ser quadrática
  for (let i = 0; i < 4000; i++) db.recordMemberCount('gperf', 100 + (i % 40));
  const t0 = Date.now();
  const perfRows = db.getMemberHistory('gperf', 365);
  const perfMs = Date.now() - t0;
  rec('histórico: consulta rápida (4000 amostras)', perfMs < 250 && perfRows.length === 1, `${perfMs}ms, linhas=${perfRows.length}`);
  db.pruneMemberHistory(30);
  rec('pruneMemberHistory (manual) so apaga o que e antigo', db.getMemberHistory('gperf', 365).length === 1 && db.getMemberHistory('g1', 90).length === 1);

  // validação de binário de backup
  const fs2 = require('fs');
  const dbBytes = fs2.readFileSync(path.join(ROOT, 'data/data.db'));
  rec('validateDbBuffer aceita a BD criada pelo bot', db.validateDbBuffer(dbBytes).ok === true, JSON.stringify(db.validateDbBuffer(dbBytes)));
  const fake = Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.alloc(4096 - 16, 0x41)]);
  rec('validateDbBuffer rejeita cabeçalho válido + lixo', db.validateDbBuffer(fake).ok === false, JSON.stringify(db.validateDbBuffer(fake)));
  rec('validateDbBuffer devolve sempre { ok, error }', typeof db.validateDbBuffer(Buffer.alloc(0)).ok === 'boolean');

  // ---------- Plugins ----------
  const { client } = require(path.join(ROOT, 'src/bot/client.js'));
  const express = require('express');
  const app = express();
  const pm = require(path.join(ROOT, 'src/utils/pluginManager.js'));

  const installed = pm.getInstalledPlugins();
  rec('12 plugins detectados', installed.length === 12, `${installed.length}`);

  const cmds = pm.loadPlugins(client, app);
  const names = cmds.map(c => (c.name || (c.data && c.data.name)));
  rec('12 plugins carregam, 25 comandos', names.length === 25, `${names.length}`);
  rec('comandos únicos', new Set(names).size === names.length, `únicos=${new Set(names).size}`);

  const badOrder = cmds.filter(c => {
    const opts = (c.toJSON ? c.toJSON() : c).options || [];
    let seenOptional = false;
    return opts.some(o => {
      if (!o.required) seenOptional = true;
      else if (seenOptional) return true;
      return false;
    });
  }).map(c => c.name);
  rec('nenhum comando com required depois de optional', badOrder.length === 0, `problemáticos: ${badOrder.join(',')}`);
  rec('toJSON() válido para todos', cmds.every(c => { try { c.toJSON(); return true; } catch { return false; } }));
  rec('getPluginPath rejeita traversal', pm.getPluginPath('../src') === null && pm.getPluginPath('..') === null && pm.getPluginPath('a/b') === null && pm.getPluginPath('music') !== null);

  const listeners = {};
  for (const ev of ['messageCreate', 'interactionCreate', 'voiceStateUpdate', 'messageDelete', 'messageUpdate', 'guildBanAdd', 'guildBanRemove', 'guildDelete']) {
    listeners[ev] = client.listenerCount(ev);
  }
  rec('messageCreate: 3 plugins', listeners.messageCreate === 3, JSON.stringify(listeners));
  rec('voiceStateUpdate: 4 (hubs, audit, levels-xp, music)', listeners.voiceStateUpdate === 4, `${listeners.voiceStateUpdate}`);

  // usa O parser real (deixou de haver uma cópia por plugin)
  const toDate = db.parseDbDate;
  rec('parse de datas ISO e SQLite', toDate(iso) !== null && toDate(sqliteStyle) !== null);
  rec('sorteio antigo já terminou / novo não', toDate(sqliteStyle).getTime() < Date.now() && toDate(iso).getTime() > Date.now());
  rec('parse de datas devolve null em lixo', toDate('não é uma data') === null && toDate(null) === null);
  sql.run('INSERT INTO xp_levels (guild_id, user_id, xp, level, last_xp_at) VALUES (?, ?, ?, ?, ?)', ['gdate', 'u-garbage', 1, 1, 'lixo']);
  db.saveDb();
  rec('cooldown não fica bloqueado por data ilegível', db.canGainXp('gdate', 'u-garbage', 3600) === true);
  sql.run('DELETE FROM xp_levels WHERE guild_id = ?', ['gdate']);

  // ---------- Contratos UI / API / plugins ----------
  const apijs = read('src/server/api.js');
  const apiExt = read('src/server/apiExtended.js');
  const appjs = read('public/app.js');
  const html = read('public/index.html');
  const notif = read('plugins/notifications/index.js');
  const cc = read('plugins/custom-commands/index.js');
  const lvl = read('plugins/levels-xp/index.js');
  const mus = read('plugins/music/index.js');
  const tick = read('plugins/tickets/index.js');
  const gw = read('plugins/giveaways/index.js');
  const hubs = read('plugins/voice-hubs/index.js');
  const clientjs = read('src/bot/client.js');
  const cfg = read('src/utils/config.js');
  const core = read('src/index.js');
  const dbjs = read('src/utils/database.js');
  const readme = read('README.md');
  const pman = read('src/utils/pluginManager.js');
  const mod = read('plugins/moderation/index.js');
  const amod = read('plugins/auto-mod/index.js');

  // Segurança / segredos
  rec('/api/plugins-ui restringe-se a ui/', apijs.includes("'/plugins-ui/:folderId/ui/:asset(*)'") && !apijs.includes('express.static(USER_PLUGINS_DIR)'));
  rec('/api/plugins-ui: ui/ tem de ser subpasta real do plugin', apijs.includes('realUiDir === realBase') && apijs.includes('const inside = (dir, parent)'));
  rec('GET /api/config mascara password e sessionSecret', apijs.includes("password: '••••••••'") && apijs.includes('sessionSecret: undefined'));
  rec('POST /api/config não devolve o config', apijs.includes('res.json({ success: true });') && !apijs.includes('config: updated'));
  rec('api.js: hubs/presence/toggle confirmam a gravacao', (apijs.match(/if \(!updateConfig\(/g) || []).length >= 4);
  rec('api.js: DISCORD_TOKEN só muda com gravacao confirmada', apijs.includes('process.env.DISCORD_TOKEN = updates.token;'));
  rec('backup para o Discord sai sem token/credenciais', clientjs.includes('delete sanitized.token') && clientjs.includes('delete sanitized.webAuth') && clientjs.includes('delete sanitized.sessionSecret'));
  rec('restore: valida BD, espera pela BD e repõe o config', apiExt.includes("router.post('/restore', async (req, res)") && apiExt.includes('await getDb();') && apiExt.includes('validateDbBuffer(dbBuffer)') && apiExt.includes('previousConfigRaw') && apiExt.includes('abortShutdown()'));
  rec('BD: runSql distingue erro SQL de falha de persistencia', dbjs.includes('persisted: true') && dbjs.includes('result.persisted = false') && dbjs.includes('Escritas suspensas'));
  rec('BD: valida colunas obrigatorias do backup', dbjs.includes('REQUIRED_SCHEMA') && dbjs.includes('PRAGMA table_info(${table})'));
  rec('BD: giveaways criado ja com winners + indice do historico', /CREATE TABLE IF NOT EXISTS giveaways \([\s\S]*?winners TEXT/.test(dbjs) && dbjs.includes('idx_member_history_guild_time'));
  rec('BD: emigracao winners via PRAGMA', dbjs.includes('PRAGMA table_info(giveaways)'));
  rec('config: atómico, le antes de decidir e recusa sem copia', cfg.includes('fs.renameSync(tmpPath, CONFIG_PATH)') && /function updateConfig\(updates\) \{[\s\S]{0,240}?const current = getConfig\(\);[\s\S]{0,300}?if \(readFailed\)/.test(cfg) && cfg.includes('config.json não contém um objeto JSON válido'));
  rec('web: parser grande so depois da autenticacao', core.includes("app.post('/api/restore', bodyParser.json({ limit:") && core.includes("req.method === 'POST'") && core.includes("=== '/api/restore'") && core.indexOf("app.post('/api/restore'") > core.indexOf("app.use('/api', authMiddleware)"));
  rec('web: erros de parsing viram JSON (413/400)', core.includes('entity.too.large') && core.includes('entity.parse.failed') && core.includes('RESTORE_BODY_LIMIT'));
  rec('restore: corpo em falta e paths com maiusculas nao rebentam', apiExt.includes('req.body || {}') && core.includes("req.path.toLowerCase() === '/api/restore'"));
  rec('sem prune automatico do historico', !core.includes('pruneMemberHistory(') && core.includes('recordMemberCount'));

  // Web UI
  rec('UI: seletores escapam nomes/ids do Discord', appjs.includes('escapeHtml(g.name)') && appjs.includes('escapeHtml(c.name)') && appjs.includes('escapeHtml(r.name)'));
  rec('UI: escapes em sorteios/leaderboard/agendados/reaction-roles', appjs.includes('escapeHtml(g.prize)') && appjs.includes('escapeHtml(e.user_id)') && appjs.includes('escapeHtml(m.content') && appjs.includes('escapeHtml(rr.title'));
  const dirtyLines = appjs.split('\n').filter(l => l.includes('innerHTML') && l.includes('${') && !l.includes('escapeHtml'));
  rec('UI: sem innerHTML com interpolacao nao escapada', dirtyLines.length === 0, dirtyLines.map(b => b.trim().slice(0, 55)).join(' | '));
  rec('UI: acoes por data-* em vez de handlers inline', appjs.includes('data-action="delete-plugin"') && appjs.includes('data-action="toggle-plugin"') && !appjs.includes("onclick=\"deleteHub") && !appjs.includes("onchange=\"togglePlugin"));
  rec('UI: feedback real dos formularios', appjs.includes('function notifySaved') && appjs.includes("showToast(r.success ? 'Boas-vindas guardadas!'"));
  rec('UI: valida resposta do restauro e do download', appjs.includes("if (!r.success) return showToast(r.error || 'Falha ao restaurar.'") && appjs.includes('O servidor não devolveu um backup'));
  rec('UI: aba de plugin nao carrega duas vezes + assets via URL', appjs.includes("container.dataset.loading === '1'") && appjs.includes('new URL(raw,'));
  rec('UI: so plugins ativos tem aba, e as outras sao removidas', appjs.includes('p.hasUi && p.enabled') && appjs.includes('Retira abas de plugins que foram desativados'));
  rec('UI: documenta os modos de auto-resposta', html.includes('^!promo$'));

  // Plugins
  rec('custom-commands exige o prefixo e aplica regex a mensagem inteira', cc.includes('if (!content.startsWith(PREFIX)) return;') && cc.includes("new RegExp(trigger, 'i').test(content)"));
  rec('levels-xp: timers com cadencia e cancelados um a um', lvl.includes('guildTimers.set(userId, { timer, intervalSeconds });') && lvl.includes('for (const entry of timers.values()) clearInterval(entry.timer);'));
  rec('levels-xp: usa state.id, reconcilia e para timers perdidos', lvl.includes('const memberId = state.id;') && lvl.includes('const present = inVoice.get(guildId) || new Set();'));
  rec('levels-xp: tick recria timer quando o intervalo muda', lvl.includes('wantedInterval !== intervalSeconds'));
  rec('levels-xp: anuncia sem canal configurado (fallback)', lvl.includes('fallbackChannel && fallbackChannel.isTextBased()'));
  rec('music: stop/finish/canal vazio saem todos do canal', mus.includes('leaveVoice(interaction.guild.id') && mus.includes('leaveVoice(queue.id, queue)') && mus.includes('EMPTY_CHANNEL_GRACE_MS'));
  rec('music: supressao do disconnect dura so a chamada', mus.includes('selfDisconnects.delete(guildId);') && !mus.includes('setTimeout(() => selfDisconnects.delete'));
  rec('music: leaveVoice cancela o timer de canal vazio', mus.includes('clearTimeout(pendingEmpty)'));
  rec('music: /play aponta para a faixa adicionada', mus.includes('songsBefore') && mus.includes('q.songs[q.songs.length - 1]'));
  rec('music: ligacao sem fila tambem e limpa', mus.includes('A fila desapareceu entretanto'));
  rec('music liga ffmpeg-static', mus.includes("require('ffmpeg-static')"));
  rec('tickets: exige ticket aberto OU suporte', tick.includes('if (!ticket && !isSupport)') && tick.includes('closing.has(channelId)'));
  rec('tickets: transcricao antes de fechar, paginada, closeTicket verificado', tick.includes('for (let page = 0; page < 10; page++)') && tick.includes('const persisted = closeTicket(channelId);') && tick.includes('if (!persisted)') && tick.includes('closingHeldByTimeout'));
  rec('tickets: so 10003 fecha registo fantasma; createTicket verificado', tick.includes('err.code === 10003 ? null : undefined') && tick.includes('const created = createTicket('));
  rec('tickets: abertura diferida antes da rede e sem reply duplicado', /customId === 'ticket_open'[\s\S]{0,400}?deferReply\(\{ ephemeral: true \}\)/.test(tick) && tick.includes('Ticket criado: ${ticketChannel}'));
  rec('apiExtended: apagar agendamento distingue 404 de 500', apiExt.includes('Agendamento não encontrado') && apiExt.includes('removed.changes === 0'));
  rec('giveaways: nao anuncia se a gravacao falhar', /const closed = endGiveaway\(gw\.id, winners\);\s*if \(!closed\) \{[\s\S]{0,240}?return;/.test(gw) && gw.includes('closed.persisted === false'));
  rec('voice-hubs: regista antes de mover e esquece em 10003', hubs.includes('remember(guild.id, {') && hubs.includes('if (err.code === 10003) forget(guildId, entry.channelId);'));
  rec('voice-hubs: exige mudanca real de canal e serializa criacoes', hubs.includes('oldState.channelId !== newState.channelId') && hubs.includes('hubCreations.delete(lockKey)'));
  rec('notificacoes: marcador offline + duracao ancorada + timeout', notif.includes('AbortSignal.timeout') && notif.includes('offline_msg=') && notif.includes('weeks?|months?|years?'));
  rec('README/plugin.json nao prometem Spotify/SoundCloud', !readme.includes('suporta YouTube, Spotify, SoundCloud') && !read('plugins/music/plugin.json').includes('YouTube, Spotify e SoundCloud'));
  rec('README: RESTORE_BODY_LIMIT documentado', readme.includes('RESTORE_BODY_LIMIT'));
  rec('README: requisito de Node e notas de gravação/restauro', readme.includes('Node.js ≥ 22.22.2') && readme.includes('restart: unless-stopped'));
  rec('package.json declara engines.node', (require(path.join(ROOT, 'package.json')).engines || {}).node === '>=22.22.2');
  rec('sessão: cookie httpOnly + sameSite=lax', core.includes("httpOnly: true, sameSite: 'lax'"));
  rec('config: password gerada com crypto.randomInt', cfg.includes('crypto.randomInt(chars.length)') && !cfg.includes('Math.floor(Math.random() * chars.length)'));
  rec('pluginManager: git/npm com timeout', (pman.match(/timeout: \d+/g) || []).length >= 2);
  rec('stats: nomes de canais resolvidos no servidor pedido', apiExt.includes('client.guilds.cache.get(guildId)') && !/const guild = client\.guilds\.cache\.first\(\);\n  const topChannelsNamed/.test(apiExt));
  rec('auto-mod: convites discord.com/invite apanhados', amod.includes("discord(?:app)?\\.com\\/invite\\/"));
  rec('BD: enterGiveaway distingue duplicado de falha', dbjs.includes('return raced ? false : null;'));
  rec('levels-xp: Maps de servidor vazios são removidos', lvl.includes('if (timers.size === 0) voiceTimers.delete(guildId);'));
  rec('datas: um único parser partilhado (sem cópias)', dbjs.includes('function parseDbDate') && !gw.includes('function toDate(') && !mod.includes("created_at + 'Z'") && dbjs.includes('parseDbDate,'));
  rec('BD: data ilegível não bloqueia o cooldown de XP', dbjs.includes('if (!lastXp) return true;'));
  rec('giveaways: falha a gravar participação não diz já participas', gw.includes('entered === null'));

  // Web UI navegação
  const dataTabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  const sectionIds = [...html.matchAll(/<section id="([^"]+)"/g)].map(m => m[1]);
  rec('abas do menu existem no HTML', dataTabs.every(t => sectionIds.includes(t)), `faltam: ${dataTabs.filter(t => !sectionIds.includes(t)).join(',')}`);
  rec('secções têm botão no menu', sectionIds.every(s => dataTabs.includes(s)), `órfãs: ${sectionIds.filter(s => !dataTabs.includes(s)).join(',')}`);

  console.log('\n================= VERIFICAÇÃO =================');
  let fails = 0;
  for (const r of results) { if (!r.ok) fails++; console.log(`${r.ok ? '  OK  ' : 'FALHA'} | ${r.name}${r.info ? ' :: ' + r.info : ''}`); }
  console.log(`\nFalhas: ${fails}/${results.length}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE:', e); process.exit(2); });
