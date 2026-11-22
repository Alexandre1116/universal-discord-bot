document.addEventListener('DOMContentLoaded', () => {
  // NAV
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const toast = document.getElementById('toastNotification');
  const toastMessage = document.getElementById('toastMessage');

  let currentConfig = {};
  let currentGuilds = [];
  let serverRoles = [];

  const tabTitles = {
    'tab-dashboard': ['Dashboard', 'Visão geral do Bot'],
    'tab-join': ['Mensagens de Entrada', 'Personaliza a boas-vindas'],
    'tab-leave': ['Mensagens de Saída', 'Configura o aviso de saída'],
    'tab-voice': ['Canais de Voz Dinâmicos', 'Criação de salas temporárias'],
    'tab-plugins': ['Plugins', 'Ativar, desativar e instalar plugins'],
    'tab-moderation': ['Auto-Moderação', 'Anti-spam, links, palavras proibidas'],
    'tab-customcmds': ['Auto-Respostas', 'Comandos personalizados do chat'],
    'tab-notifications': ['Notificações', 'YouTube e Twitch'],
    'tab-audit': ['Audit Logs', 'Registo automático de eventos'],
    'tab-tickets': ['Sistema de Tickets', 'Suporte com canais privados'],
    'tab-reactionroles': ['Reaction Roles', 'Cargos por botão'],
    'tab-levels': ['Níveis / XP', 'Sistema de progresso'],
    'tab-embeds': ['Embeds & Agendados', 'Enviar e agendar mensagens'],
    'tab-giveaways': ['Giveaways', 'Sorteios no servidor'],
    'tab-stats': ['Estatísticas', 'Gráficos e dados do servidor'],
    'tab-settings': ['Definições', 'Token, backups e comandos']
  };

  // NAV CLICK
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      const section = document.getElementById(tabId);
      if (!section) {
        console.warn(`[NAV] Aba desconhecida: ${tabId}`);
        return;
      }
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      item.classList.add('active');
      section.classList.add('active');
      const t = tabTitles[tabId];
      if (t) { pageTitle.textContent = t[0]; pageSubtitle.textContent = t[1]; }
      // Load tab-specific data
      if (tabId === 'tab-stats') loadStats();
      if (tabId === 'tab-levels') loadLeaderboard();
      if (tabId === 'tab-giveaways') loadGiveaways();
      if (tabId === 'tab-embeds') loadScheduled();
      if (tabId === 'tab-plugins') fetchPlugins();
    });
  });

  function showToast(msg, isError = false) {
    toastMessage.textContent = msg;
    toast.style.backgroundColor = isError ? '#ed4245' : '#57f287';
    toast.style.color = isError ? '#fff' : '#000';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  // TOKEN TOGGLE
  document.getElementById('btnToggleToken').addEventListener('click', () => {
    const inp = document.getElementById('botTokenInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // ========== DATA LOADERS ==========
  async function fetchStatus() {
    try {
      const r = await fetch('/api/auth/status'); const auth = await r.json();
      if (!auth.loggedIn) {
        document.getElementById('loginModal').classList.remove('hidden');
        return false;
      }
      
      const res = await fetch('/api/status'); const d = await res.json();
      document.getElementById('statusDot').className = 'status-indicator ' + (d.isReady ? 'online' : 'offline');
      document.getElementById('botNameText').textContent = d.user ? d.user.tag : 'Desconectado';
      document.getElementById('botPingText').textContent = d.isReady ? `Ping: ${d.ping}ms` : 'Off';
      document.getElementById('dashBotStatus').textContent = d.isReady ? 'ONLINE' : 'OFFLINE';
      document.getElementById('dashBotStatus').style.color = d.isReady ? '#57f287' : '#ed4245';
      document.getElementById('dashGuildsCount').textContent = d.guildsCount || 0;
      document.getElementById('dashPing').textContent = d.isReady ? `${d.ping}ms` : '--';
      return true;
    } catch (e) { console.error(e); return false; }
  }

  async function loadAllData() {
    const loggedIn = await fetchStatus();
    if (!loggedIn) return;
    
    await fetchConfig();
    await fetchGuilds();
    await fetchRoles();
    await fetchModeration();
    await fetchAuditLog();
    await fetchTickets();
    await fetchReactionRoles();
    await fetchLevelsConfig();
    await fetchCustomCommands();
    await fetchPlugins();
    await fetchNotifications();
    await fetchWebSettings();
  }

  async function fetchWebSettings() {
    try {
      const r = await fetch('/api/web-settings'); const d = await r.json();
      setVal('webBotOwners', (d.botOwners || []).join('\n'));
    } catch (e) { console.error(e); }
  }

  async function fetchConfig() {
    try {
      const r = await fetch('/api/config'); currentConfig = await r.json();
      const d = currentConfig;
      // Join config
      if (d.joinMessage) {
        setVal('joinEnabled', !!d.joinMessage.enabled, 'checked');
        setVal('joinChannelSelect', d.joinMessage.channelId);
        setVal('joinMessageType', d.joinMessage.messageType);
        setVal('joinEmbedTitle', d.joinMessage.embedTitle);
        setVal('joinContent', d.joinMessage.content);
        setVal('joinEmbedColorPicker', d.joinMessage.embedColor || '#5865F2');
        setVal('joinEmbedColor', d.joinMessage.embedColor || '#5865F2');
        setVal('joinShowAvatar', d.joinMessage.showAvatar !== false, 'checked');
        setVal('joinGenerateImage', !!d.joinMessage.generateImage, 'checked');
        setVal('joinImageBackgroundUrl', d.joinMessage.imageBackgroundUrl || '');
        updateJoinPreview();
      }
      const l = currentConfig.leaveMessage || {};
      setVal('leaveEnabled', l.enabled !== false, 'checked');
      setVal('leaveMessageType', l.messageType || 'embed');
      setVal('leaveEmbedTitle', l.embedTitle || '');
      setVal('leaveContent', l.content || '');
      setVal('leaveEmbedColor', l.embedColor || '#ED4245');
      setVal('leaveEmbedColorPicker', l.embedColor || '#ED4245');
      setVal('leaveShowAvatar', l.showAvatar !== false, 'checked');
      document.getElementById('dashVoiceHubsCount').textContent = (currentConfig.voiceHubs || []).length;
      renderVoiceHubs(currentConfig.voiceHubs || []);
      updateJoinPreview(); updateLeavePreview();
      
      const p = currentConfig.presence || {};
      setVal('presenceStatus', p.status || 'online');
      setVal('presenceType', p.activityType || 'Playing');
      setVal('presenceText', p.activityText || '');

      const b = currentConfig.backup || {};
      setVal('backupAutoEnabled', !!b.autoBackup, 'checked');
    } catch (e) { console.error(e); }
  }

  async function fetchGuilds() {
    try {
      const r = await fetch('/api/guilds'); const d = await r.json();
      currentGuilds = d.guilds || [];
      document.getElementById('guildsBadge').textContent = `${currentGuilds.length} servidores`;
      renderGuilds(currentGuilds);
      populateChannelDropdowns(currentGuilds);
    } catch (e) { console.error(e); }
  }

  async function fetchRoles() {
    try {
      const r = await fetch('/api/roles'); serverRoles = await r.json();
      populateRoleDropdowns();
    } catch (e) { console.error(e); }
  }

  async function fetchModeration() {
    try {
      const r = await fetch('/api/moderation'); const d = await r.json();
      setVal('modEnabled', !!d.enabled, 'checked');
      setVal('modAntiSpam', !!d.antiSpam, 'checked');
      setVal('modAntiLinks', !!d.antiLinks, 'checked');
      setVal('modAntiCaps', !!d.antiCaps, 'checked');
      setVal('modBannedWords', (d.bannedWords || []).join('\n'));
      setVal('modMaxStrikes', d.maxStrikes || 3);
      setVal('modStrikeAction', d.strikeAction || 'mute');
    } catch (e) { console.error(e); }
  }

  async function fetchAuditLog() {
    try {
      const r = await fetch('/api/audit-log'); const d = await r.json();
      setVal('auditEnabled', !!d.enabled, 'checked');
      setVal('auditMsgDelete', d.messageDelete !== false, 'checked');
      setVal('auditMsgEdit', d.messageEdit !== false, 'checked');
      setVal('auditBans', d.bans !== false, 'checked');
      setVal('auditVoice', d.voiceJoinLeave !== false, 'checked');
      setTimeout(() => { if (d.channelId) setVal('auditChannelSelect', d.channelId); }, 500);
    } catch (e) { console.error(e); }
  }

  async function fetchTickets() {
    try {
      const r = await fetch('/api/tickets/config'); const d = await r.json();
      setTimeout(() => {
        if (d.supportRoleId) setVal('ticketSupportRole', d.supportRoleId);
        if (d.logChannelId) setVal('ticketLogChannel', d.logChannelId);
      }, 500);
      // Categories
      const cr = await fetch('/api/categories'); const cats = await cr.json();
      const catSel = document.getElementById('ticketCategory');
      catSel.innerHTML = '<option value="">Sem categoria</option>' + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (d.categoryId) catSel.value = d.categoryId;
    } catch (e) { console.error(e); }
  }

  async function fetchReactionRoles() {
    try {
      const r = await fetch('/api/reaction-roles'); const d = await r.json();
      renderExistingRR(d);
    } catch (e) { console.error(e); }
  }

  async function fetchLevelsConfig() {
    try {
      const r = await fetch('/api/levels/config'); const d = await r.json();
      setVal('levelsEnabled', !!d.enabled, 'checked');
      setVal('levelsMinXp', d.minXp || 15);
      setVal('levelsMaxXp', d.maxXp || 25);
      setVal('levelsXpCooldown', d.xpCooldown || 60);
      setVal('levelsVoiceEnabled', d.voiceXpEnabled !== false, 'checked');
      setVal('levelsVoiceInterval', d.voiceXpInterval || 60);
      setVal('levelsVoiceAmount', d.voiceXpAmount || 5);
      setTimeout(() => { if (d.announceChannelId) setVal('levelsAnnounceChannel', d.announceChannelId); }, 500);
      renderLevelRoles(d.roles || []);
    } catch (e) { console.error(e); }
  }

  // ========== HELPERS ==========
  function setVal(id, val, prop) {
    const el = document.getElementById(id);
    if (!el) return;
    if (prop === 'checked') el.checked = val;
    else el.value = val;
  }
  function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function getChecked(id) { const el = document.getElementById(id); return el ? el.checked : false; }

  // ========== RENDERS ==========
  function renderGuilds(guilds) {
    const el = document.getElementById('guildsList');
    if (!guilds.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-robot"></i><p>Sem servidores.</p></div>'; return; }
    el.innerHTML = guilds.map(g => `<div class="guild-card"><div class="guild-icon">${g.icon ? `<img src="${g.icon}" style="width:100%;height:100%;border-radius:50%">` : g.name[0]}</div><div class="guild-info"><h4>${g.name}</h4><span>${g.textChannels.length} texto | ${g.voiceChannels.length} voz</span></div></div>`).join('');
  }

  function populateChannelDropdowns(guilds) {
    let textOpts = '<option value="">-- Selecionar Canal --</option>';
    let voiceOpts = '<option value="">-- Selecionar Canal de Voz --</option>';
    guilds.forEach(g => {
      if (g.textChannels.length) { textOpts += `<optgroup label="${g.name}">${g.textChannels.map(c => `<option value="${c.id}"># ${c.name}</option>`).join('')}</optgroup>`; }
      if (g.voiceChannels.length) { voiceOpts += `<optgroup label="${g.name}">${g.voiceChannels.map(c => `<option value="${c.id}">🔊 ${c.name}</option>`).join('')}</optgroup>`; }
    });
    ['joinChannelSelect', 'leaveChannelSelect', 'auditChannelSelect', 'rrChannelSelect', 'embedChannelSelect', 'scheduleChannelSelect', 'ticketLogChannel', 'levelsAnnounceChannel', 'backupChannelSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = textOpts;
    });
    const vh = document.getElementById('voiceHubSelect');
    if (vh) vh.innerHTML = voiceOpts;
    // Restore saved values
    if (currentConfig.joinMessage?.channelId) setVal('joinChannelSelect', currentConfig.joinMessage.channelId);
    if (currentConfig.leaveMessage?.channelId) setVal('leaveChannelSelect', currentConfig.leaveMessage.channelId);
    if (currentConfig.backup?.channelId) setVal('backupChannelSelect', currentConfig.backup.channelId);
  }

  function populateRoleDropdowns() {
    const roleOpts = '<option value="">-- Cargo --</option>' + serverRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    const el = document.getElementById('ticketSupportRole');
    if (el) el.innerHTML = roleOpts;
  }

  function renderVoiceHubs(hubs) {
    const el = document.getElementById('voiceHubsList');
    if (!hubs.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-microphone-slash"></i><p>Nenhum hub.</p></div>'; return; }
    el.innerHTML = hubs.map(h => `<div class="hub-card"><div class="hub-info"><h5><i class="fa-solid fa-microphone" style="color:var(--accent-purple)"></i> ${h.channelId}</h5><p>Padrão: <code>${h.namePattern}</code> | Limite: ${h.userLimit > 0 ? h.userLimit : 'Original'}</p></div><button class="btn btn-danger btn-sm" onclick="deleteHub('${h.id || h.channelId}')"><i class="fa-solid fa-trash"></i></button></div>`).join('');
  }

  // ========== PREVIEWS ==========
  function updateJoinPreview() {
    const isEmbed = getVal('joinMessageType') === 'embed';
    const content = (getVal('joinContent') || 'Bem-vindo!').replace(/{user}/g, '@Membro').replace(/{username}/g, 'Membro').replace(/{server}/g, 'Servidor').replace(/{count}/g, '100');
    if (isEmbed) {
      document.getElementById('prevJoinEmbed').classList.remove('hidden');
      document.getElementById('prevJoinTextOnly').classList.add('hidden');
      document.getElementById('prevJoinTitle').textContent = getVal('joinEmbedTitle') || '👋';
      document.getElementById('prevJoinDesc').textContent = content;
      document.getElementById('prevJoinBar').style.backgroundColor = getVal('joinEmbedColor');
      document.getElementById('prevJoinThumb').style.display = getChecked('joinShowAvatar') ? 'block' : 'none';
    } else {
      document.getElementById('prevJoinEmbed').classList.add('hidden');
      document.getElementById('prevJoinTextOnly').classList.remove('hidden');
      document.getElementById('prevJoinTextOnly').textContent = content;
    }
  }

  function updateLeavePreview() {
    const isEmbed = getVal('leaveMessageType') === 'embed';
    const content = (getVal('leaveContent') || 'Saiu.').replace(/{user}/g, '**Membro**').replace(/{username}/g, 'Membro').replace(/{server}/g, 'Servidor').replace(/{count}/g, '99');
    if (isEmbed) {
      document.getElementById('prevLeaveEmbed').classList.remove('hidden');
      document.getElementById('prevLeaveTextOnly').classList.add('hidden');
      document.getElementById('prevLeaveTitle').textContent = getVal('leaveEmbedTitle') || '🚪';
      document.getElementById('prevLeaveDesc').textContent = content;
      document.getElementById('prevLeaveBar').style.backgroundColor = getVal('leaveEmbedColor');
      document.getElementById('prevLeaveThumb').style.display = getChecked('leaveShowAvatar') ? 'block' : 'none';
    } else {
      document.getElementById('prevLeaveEmbed').classList.add('hidden');
      document.getElementById('prevLeaveTextOnly').classList.remove('hidden');
      document.getElementById('prevLeaveTextOnly').textContent = content;
    }
  }

  // Live preview listeners
  ['joinMessageType', 'joinEmbedTitle', 'joinContent', 'joinShowAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', updateJoinPreview); el.addEventListener('change', updateJoinPreview); }
  });
  ['leaveMessageType', 'leaveEmbedTitle', 'leaveContent', 'leaveShowAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', updateLeavePreview); el.addEventListener('change', updateLeavePreview); }
  });
  document.getElementById('joinEmbedColorPicker').addEventListener('input', e => { setVal('joinEmbedColor', e.target.value); updateJoinPreview(); });
  document.getElementById('joinEmbedColor').addEventListener('input', e => { setVal('joinEmbedColorPicker', e.target.value); updateJoinPreview(); });
  document.getElementById('leaveEmbedColorPicker').addEventListener('input', e => { setVal('leaveEmbedColor', e.target.value); updateLeavePreview(); });
  document.getElementById('leaveEmbedColor').addEventListener('input', e => { setVal('leaveEmbedColorPicker', e.target.value); updateLeavePreview(); });
  document.getElementById('rrColorPicker')?.addEventListener('input', e => setVal('rrColor', e.target.value));
  document.getElementById('embedColorPicker')?.addEventListener('input', e => setVal('embedColor', e.target.value));

  // ========== FORM SUBMISSIONS ==========

  // JOIN
  document.getElementById('formJoinConfig').addEventListener('submit', async e => {
    e.preventDefault();
    await postJson('/api/config', { joinMessage: { enabled: getChecked('joinEnabled'), channelId: getVal('joinChannelSelect'), messageType: getVal('joinMessageType'), embedTitle: getVal('joinEmbedTitle'), content: getVal('joinContent'), embedColor: getVal('joinEmbedColor'), showAvatar: getChecked('joinShowAvatar'), generateImage: getChecked('joinGenerateImage'), imageBackgroundUrl: getVal('joinImageBackgroundUrl') } });
    showToast('Boas-vindas guardadas!'); fetchConfig();
  });

  // LEAVE
  document.getElementById('formLeaveConfig').addEventListener('submit', async e => {
    e.preventDefault();
    await postJson('/api/config', { leaveMessage: { enabled: getChecked('leaveEnabled'), channelId: getVal('leaveChannelSelect'), messageType: getVal('leaveMessageType'), embedTitle: getVal('leaveEmbedTitle'), content: getVal('leaveContent'), embedColor: getVal('leaveEmbedColor'), showAvatar: getChecked('leaveShowAvatar') } });
    showToast('Saída guardada!'); fetchConfig();
  });

  // TEST JOIN/LEAVE
  document.getElementById('btnTestJoin').addEventListener('click', async () => {
    const ch = getVal('joinChannelSelect'); if (!ch) return showToast('Seleciona um canal!', true);
    const r = await postJson('/api/test-message', { type: 'join', channelId: ch });
    showToast(r.success ? 'Teste enviado!' : r.error, !r.success);
  });
  document.getElementById('btnTestLeave').addEventListener('click', async () => {
    const ch = getVal('leaveChannelSelect'); if (!ch) return showToast('Seleciona um canal!', true);
    const r = await postJson('/api/test-message', { type: 'leave', channelId: ch });
    showToast(r.success ? 'Teste enviado!' : r.error, !r.success);
  });

  // VOICE HUBS
  document.getElementById('formAddVoiceHub').addEventListener('submit', async e => {
    e.preventDefault();
    const ch = getVal('voiceHubSelect'); if (!ch) return showToast('Seleciona um canal!', true);
    await postJson('/api/hubs', { channelId: ch, namePattern: getVal('voiceNamePattern'), userLimit: getVal('voiceUserLimit') });
    showToast('Hub adicionado!'); fetchConfig();
  });
  window.deleteHub = async id => {
    await fetch(`/api/hubs/${id}`, { method: 'DELETE' });
    showToast('Hub removido!'); fetchConfig();
  };

  // MODERATION
  document.getElementById('formModeration').addEventListener('submit', async e => {
    e.preventDefault();
    await postJson('/api/moderation', {
      enabled: getChecked('modEnabled'), antiSpam: getChecked('modAntiSpam'), antiLinks: getChecked('modAntiLinks'), antiCaps: getChecked('modAntiCaps'),
      bannedWords: getVal('modBannedWords').split('\n').map(w => w.trim()).filter(w => w),
      maxStrikes: parseInt(getVal('modMaxStrikes')) || 3, strikeAction: getVal('modStrikeAction')
    });
    showToast('Moderação guardada!');
  });

  // AUDIT LOG
  document.getElementById('formAuditLog').addEventListener('submit', async e => {
    e.preventDefault();
    await postJson('/api/audit-log', {
      enabled: getChecked('auditEnabled'), channelId: getVal('auditChannelSelect'),
      messageDelete: getChecked('auditMsgDelete'), messageEdit: getChecked('auditMsgEdit'),
      bans: getChecked('auditBans'), voiceJoinLeave: getChecked('auditVoice')
    });
    showToast('Audit Log guardado!');
  });

  // TICKETS
  document.getElementById('formTickets').addEventListener('submit', async e => {
    e.preventDefault();
    await postJson('/api/tickets/config', {
      supportRoleId: getVal('ticketSupportRole'), categoryId: getVal('ticketCategory'), logChannelId: getVal('ticketLogChannel')
    });
    showToast('Tickets configurados!');
  });

  // REACTION ROLES
  document.getElementById('btnAddRrRole').addEventListener('click', () => addRrRoleRow());
  document.getElementById('formReactionRole').addEventListener('submit', async e => {
    e.preventDefault();
    const rows = document.querySelectorAll('#rrRolesList .rr-role-row');
    const roles = [];
    rows.forEach(row => {
      const sel = row.querySelector('select'); const label = row.querySelector('input[type="text"]');
      const emoji = row.querySelector('input[placeholder="Emoji"]');
      if (sel && sel.value) roles.push({ roleId: sel.value, label: label?.value || sel.options[sel.selectedIndex]?.text || '', emoji: emoji?.value || '🔘' });
    });
    if (!roles.length) return showToast('Adiciona pelo menos um cargo!', true);
    const r = await postJson('/api/reaction-roles', {
      channelId: getVal('rrChannelSelect'), title: getVal('rrTitle'), description: getVal('rrDescription'), color: getVal('rrColor'), roles
    });
    showToast(r.success ? 'Painel criado!' : r.error, !r.success);
    fetchReactionRoles();
  });

  // CUSTOM COMMANDS
  async function fetchCustomCommands() {
    try {
      const r = await fetch('/api/custom-commands'); const cmds = await r.json();
      renderCustomCommands(cmds || []);
    } catch (e) { console.error(e); }
  }
  
  function renderCustomCommands(cmds) {
    const container = document.getElementById('customCmdsList');
    container.innerHTML = '';
    if (!cmds.length) {
      container.innerHTML = '<div class="empty-state"><p>Sem auto-respostas configuradas.</p></div>';
    } else {
      cmds.forEach(cmd => addCustomCmdRow(cmd.trigger, cmd.response, cmd.matchType));
    }
  }

  function addCustomCmdRow(trigger = '', response = '', matchType = 'exact') {
    const container = document.getElementById('customCmdsList');
    if (!container) return;
    // remover state vazio se existir
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'rr-role-row';
    row.innerHTML = `<select class="form-control cmd-match" style="max-width:140px"><option value="exact" ${matchType === 'exact' ? 'selected' : ''}>Texto exato</option><option value="startsWith" ${matchType === 'startsWith' ? 'selected' : ''}>Começa por</option><option value="regex" ${matchType === 'regex' ? 'selected' : ''}>Regex</option></select><input type="text" class="form-control cmd-trigger" placeholder="Trigger (ex: regras — sem o !)" value="${trigger}"><input type="text" class="form-control cmd-response" placeholder="Resposta do bot" value="${response}"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(row);
  }

  document.getElementById('btnAddCustomCmd').addEventListener('click', () => addCustomCmdRow());
  document.getElementById('formCustomCmds').addEventListener('submit', async e => {
    e.preventDefault();
    const rows = document.querySelectorAll('#customCmdsList .rr-role-row');
    const commands = [];
    rows.forEach(row => {
      const matchType = row.querySelector('.cmd-match').value;
      const trigger = row.querySelector('.cmd-trigger').value.trim();
      const response = row.querySelector('.cmd-response').value.trim();
      if (trigger && response) commands.push({ trigger, response, matchType });
    });
    const r = await postJson('/api/custom-commands', { commands });
    showToast(r.success ? 'Auto-respostas guardadas!' : r.error, !r.success);
  });

  // PLUGINS
  function injectPluginTabs(plugins) {
    const nav = document.querySelector('.nav-menu');
    const main = document.querySelector('.main-content');
    if (!nav || !main) return;

    plugins.filter(p => p.hasUi).forEach(p => {
      const tabId = `tab-plugin-${p.folderId}`;
      if (document.getElementById(tabId)) return;

      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.setAttribute('data-tab', tabId);
      btn.innerHTML = `<i class="fa-solid fa-puzzle-piece"></i><span>${p.displayName || p.name}</span>`;

      const section = document.createElement('section');
      section.id = tabId;
      section.className = 'tab-content';
      section.innerHTML = `<div class="content-card"><div class="card-body plugin-ui-container" data-plugin="${p.folderId}">A carregar a interface do plugin…</div></div>`;

      nav.appendChild(btn);
      main.appendChild(section);

      btn.addEventListener('click', async () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        section.classList.add('active');
        pageTitle.textContent = p.displayName || p.name;
        pageSubtitle.textContent = p.description || `Plugin: ${p.folderId}`;

        const container = section.querySelector('.plugin-ui-container');
        if (container.dataset.loaded === '1') return;
        try {
          const res = await fetch(`/api/plugins-ui/${p.folderId}/ui/tab.html`);
          if (!res.ok) throw new Error(`tab.html não encontrado (HTTP ${res.status})`);
          container.innerHTML = await res.text();
          container.dataset.loaded = '1';
          // Recria <script> para que sejam efetivamente executados
          container.querySelectorAll('script').forEach(old => {
            const fresh = document.createElement('script');
            if (old.src) fresh.src = old.src; else fresh.textContent = old.textContent;
            old.replaceWith(fresh);
          });
        } catch (err) {
          container.innerHTML = `<p style="color:#ed4245">Não foi possível carregar a aba do plugin: ${err.message}</p>`;
        }
      });
    });
  }

  async function fetchPlugins() {
    try {
      const r = await fetch('/api/plugins'); 
      const plugins = await r.json();
      const list = document.getElementById('pluginsList');
      if (!list) return;

      injectPluginTabs(plugins);

      if (plugins.length === 0) {
        list.innerHTML = '<p>Nenhum plugin instalado.</p>';
        return;
      }

      let html = '';
      for (const p of plugins) {
        html += `
        <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h5 style="margin: 0; color: #fff;">${p.displayName || p.name} <small style="color: #aaa;">v${p.version || '1.0'}</small></h5>
            <p style="margin: 5px 0 0 0; font-size: 0.9em; color: #ccc;">${p.description || 'Sem descrição.'}</p>
            <p style="margin: 5px 0 0 0; font-size: 0.8em; color: #888;">Autor: ${p.author || 'Desconhecido'} | ID: ${p.folderId}${p.isOfficial ? ' (oficial)' : ''}</p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <label class="toggle-switch">
              <input type="checkbox" onchange="togglePlugin('${p.folderId}', this.checked)" ${p.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            ${p.isOfficial ? '' : `<button class="btn btn-danger btn-sm" onclick="deletePlugin('${p.folderId}')"><i class="fa-solid fa-trash"></i></button>`}
          </div>
        </div>`;
      }
      list.innerHTML = html;
    } catch (e) { console.error(e); }
  }

  window.togglePlugin = async (pluginId, enabled) => {
    const r = await postJson('/api/plugins/toggle', { pluginId, enabled });
    showToast(r.success ? 'Estado do plugin atualizado! (Requer reinício do bot para aplicar na totalidade)' : 'Erro', !r.success);
  };

  window.deletePlugin = async (pluginId) => {
    if (!confirm('Tens a certeza que queres eliminar este plugin?')) return;
    try {
      const res = await fetch(`/api/plugins/${pluginId}`, { method: 'DELETE' });
      const r = await res.json();
      showToast(r.success ? 'Plugin eliminado com sucesso!' : r.error, !r.success);
      fetchPlugins();
    } catch (e) { console.error(e); }
  };

  const formInstallPlugin = document.getElementById('formInstallPlugin');
  if (formInstallPlugin) {
    formInstallPlugin.addEventListener('submit', async e => {
      e.preventDefault();
      const url = document.getElementById('pluginGithubUrl').value;
      const r = await postJson('/api/plugins/install', { url });
      showToast(r.success ? r.message : r.error, !r.success);
      if (r.success) {
        document.getElementById('pluginGithubUrl').value = '';
        fetchPlugins();
      }
    });
  }

  // NOTIFICATIONS
  async function fetchNotifications() {
    try {
      const r = await fetch('/api/notifications'); const d = await r.json();
      renderNotifications(d.youtube || []);
      renderTwitch(d.twitch || []);
    } catch (e) { console.error(e); }
  }

  function channelOptions(selected) {
    let opts = '<option value="">-- Selecionar Canal --</option>';
    currentGuilds.forEach(g => {
      if (g.textChannels.length) { opts += `<optgroup label="${g.name}">${g.textChannels.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}># ${c.name}</option>`).join('')}</optgroup>`; }
    });
    return opts;
  }

  function roleOptions(selected) {
    return '<option value="">-- Sem cargo --</option>' + serverRoles.map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${r.name}</option>`).join('');
  }

  function renderNotifications(list) {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div class="empty-state"><p>Sem canais configurados.</p></div>';
    } else {
      // Aceita o formato novo {channelId (YouTube), discordChannelId} e o antigo {youtubeId, channelId}
      list.forEach(n => {
        const youtubeId = n.youtubeId || n.channelId;
        const discordChannelId = n.discordChannelId || (n.youtubeId ? n.channelId : '');
        addNotificationRow(youtubeId, discordChannelId, n.message, n.roleToPing);
      });
    }
  }

  function addNotificationRow(youtubeId = '', discordChannelId = '', message = '', roleToPing = '') {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'rr-role-row';
    row.innerHTML = `<input type="text" class="form-control notif-ytid" placeholder="ID do Canal YT (ex: UCXXXXX)" value="${youtubeId}"><select class="form-control notif-channel">${channelOptions(discordChannelId)}</select><input type="text" class="form-control notif-msg" placeholder="Mensagem (usa {title} {url})" value="${message || ''}"><select class="form-control notif-role">${roleOptions(roleToPing)}</select><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(row);
  }

  function renderTwitch(list) {
    const container = document.getElementById('twitchList');
    if (!container) return;
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div class="empty-state"><p>Sem canais Twitch.</p></div>';
    } else {
      list.forEach(t => addTwitchRow(t.username, t.discordChannelId, t.roleToPing));
    }
  }

  function addTwitchRow(username = '', discordChannelId = '', roleToPing = '') {
    const container = document.getElementById('twitchList');
    if (!container) return;
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'rr-role-row';
    row.innerHTML = `<input type="text" class="form-control tw-name" placeholder="Nome do canal Twitch" value="${username}"><select class="form-control tw-channel">${channelOptions(discordChannelId)}</select><select class="form-control tw-role">${roleOptions(roleToPing)}</select><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(row);
  }

  document.getElementById('btnAddNotification').addEventListener('click', () => addNotificationRow());
  document.getElementById('formNotifications').addEventListener('submit', async e => {
    e.preventDefault();
    const rows = document.querySelectorAll('#notificationsList .rr-role-row');
    const youtube = [];
    rows.forEach(row => {
      const youtubeId = row.querySelector('.notif-ytid').value.trim();
      const discordChannelId = row.querySelector('.notif-channel').value;
      const message = row.querySelector('.notif-msg').value.trim();
      const roleToPing = row.querySelector('.notif-role')?.value || '';
      if (youtubeId && discordChannelId) youtube.push({ channelId: youtubeId, youtubeId, discordChannelId, message, roleToPing });
    });
    const r = await postJson('/api/notifications', { youtube });
    showToast(r.success ? 'Notificações guardadas!' : r.error, !r.success);
  });

  document.getElementById('btnAddTwitch')?.addEventListener('click', () => addTwitchRow());
  document.getElementById('formTwitchNotifications')?.addEventListener('submit', async e => {
    e.preventDefault();
    const rows = document.querySelectorAll('#twitchList .rr-role-row');
    const twitch = [];
    rows.forEach(row => {
      const username = row.querySelector('.tw-name').value.trim();
      const discordChannelId = row.querySelector('.tw-channel').value;
      const roleToPing = row.querySelector('.tw-role')?.value || '';
      if (username && discordChannelId) twitch.push({ username, discordChannelId, roleToPing });
    });
    const r = await postJson('/api/notifications', { twitch });
    showToast(r.success ? 'Notificações Twitch guardadas!' : r.error, !r.success);
  });

  function addRrRoleRow() {
    const container = document.getElementById('rrRolesList');
    const row = document.createElement('div');
    row.className = 'rr-role-row';
    row.innerHTML = `<select class="form-control"><option value="">Cargo</option>${serverRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select><input type="text" class="form-control" placeholder="Emoji" style="max-width:60px"><input type="text" class="form-control" placeholder="Label do botão"><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(row);
  }

  function renderExistingRR(list) {
    const el = document.getElementById('rrExistingList');
    if (!list.length) { el.innerHTML = '<div class="empty-state"><p>Nenhum painel.</p></div>'; return; }
    el.innerHTML = list.map(rr => `<div class="hub-card"><div class="hub-info"><h5>${rr.title || 'Reaction Roles'}</h5><p>${(rr.roles || []).length} cargos | Canal: ${rr.channelId}</p></div><button class="btn btn-danger btn-sm" onclick="deleteRR('${rr.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join('');
  }
  window.deleteRR = async id => {
    await fetch(`/api/reaction-roles/${id}`, { method: 'DELETE' });
    showToast('Painel removido!'); fetchReactionRoles();
  };

  // LEVELS
  document.getElementById('btnAddLevelRole').addEventListener('click', () => addLevelRoleRow());
  document.getElementById('formLevels').addEventListener('submit', async e => {
    e.preventDefault();
    const rows = document.querySelectorAll('#levelRolesList .rr-role-row');
    const roles = [];
    rows.forEach(row => {
      const typeSel = row.querySelector('.reward-type');
      const req = row.querySelector('input[type="number"]');
      const roleSel = row.querySelector('.reward-role');
      if (req && roleSel && roleSel.value) {
        roles.push({ type: typeSel.value, requirement: parseInt(req.value), roleId: roleSel.value });
      }
    });
    await postJson('/api/levels/config', {
      enabled: getChecked('levelsEnabled'), minXp: parseInt(getVal('levelsMinXp')), maxXp: parseInt(getVal('levelsMaxXp')),
      xpCooldown: parseInt(getVal('levelsXpCooldown')), announceChannelId: getVal('levelsAnnounceChannel'), roles,
      voiceXpEnabled: getChecked('levelsVoiceEnabled'),
      voiceXpInterval: parseInt(getVal('levelsVoiceInterval')) || 60,
      voiceXpAmount: parseInt(getVal('levelsVoiceAmount')) || 5
    });
    showToast('Níveis guardados!');
  });

  function addLevelRoleRow(type = 'level', reqValue = '', roleId = '') {
    const container = document.getElementById('levelRolesList');
    const row = document.createElement('div');
    row.className = 'rr-role-row';
    row.innerHTML = `<select class="form-control reward-type" style="max-width:100px"><option value="level" ${type === 'level' ? 'selected' : ''}>Nível</option><option value="xp" ${type === 'xp' ? 'selected' : ''}>XP</option></select><input type="number" class="form-control" placeholder="Requisito" min="1" value="${reqValue}" style="max-width:100px"><select class="form-control reward-role"><option value="">Cargo</option>${serverRoles.map(r => `<option value="${r.id}" ${r.id === roleId ? 'selected' : ''}>${r.name}</option>`).join('')}</select><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(row);
  }

  function renderLevelRoles(roles) {
    document.getElementById('levelRolesList').innerHTML = '';
    roles.forEach(r => {
      const type = r.type || 'level';
      const req = r.requirement || r.level;
      addLevelRoleRow(type, req, r.roleId);
    });
  }

  async function loadLeaderboard() {
    const guildId = currentGuilds[0]?.id; if (!guildId) return;
    try {
      const r = await fetch(`/api/levels/leaderboard/${guildId}`); const d = await r.json();
      const el = document.getElementById('leaderboardList');
      const medals = ['🥇', '🥈', '🥉'];
      if (!d.length) { el.innerHTML = '<div class="empty-state"><p>Sem dados de XP.</p></div>'; return; }
      el.innerHTML = d.map((e, i) => `<div class="leaderboard-entry"><span class="leaderboard-rank">${i < 3 ? medals[i] : '#' + (i + 1)}</span><div class="leaderboard-info"><h5>${e.user_id}</h5><span>Nível ${e.level} | ${e.total_messages} msgs</span></div><span class="leaderboard-xp">${e.xp} XP</span></div>`).join('');
    } catch (e) { console.error(e); }
  }

  // EMBEDS
  document.getElementById('formSendEmbed').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await postJson('/api/send-embed', {
      channelId: getVal('embedChannelSelect'), title: getVal('embedTitle'), description: getVal('embedDescription'),
      color: getVal('embedColor'), footer: getVal('embedFooter'), image: getVal('embedImage')
    });
    showToast(r.success ? 'Embed enviado!' : r.error, !r.success);
  });

  // SCHEDULED MESSAGES
  document.getElementById('formScheduleMsg').addEventListener('submit', async e => {
    e.preventDefault();
    const guildId = currentGuilds[0]?.id || '';
    const r = await postJson('/api/scheduled-messages', {
      guildId, channelId: getVal('scheduleChannelSelect'), content: getVal('scheduleContent'), cronExpression: getVal('scheduleCron')
    });
    showToast(r.success ? 'Agendado!' : r.error, !r.success);
    loadScheduled();
  });

  async function loadScheduled() {
    const guildId = currentGuilds[0]?.id; if (!guildId) return;
    try {
      const r = await fetch(`/api/scheduled-messages/${guildId}`); const d = await r.json();
      const el = document.getElementById('scheduledList');
      if (!d.length) { el.innerHTML = '<div class="empty-state"><p>Sem agendados.</p></div>'; return; }
      el.innerHTML = d.map(m => `<div class="scheduled-card"><div class="sched-info"><h5>${m.content?.substring(0, 50) || 'Embed'}</h5><span>Cron: ${m.cron_expression || 'One-shot'} | Canal: ${m.channel_id}</span></div><button class="btn btn-danger btn-sm" onclick="deleteSched(${m.id})"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    } catch (e) { console.error(e); }
  }
  window.deleteSched = async id => {
    await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' });
    showToast('Removido!'); loadScheduled();
  };

  // GIVEAWAYS
  async function loadGiveaways() {
    const guildId = currentGuilds[0]?.id; if (!guildId) return;
    try {
      const r = await fetch(`/api/giveaways/${guildId}`); const d = await r.json();
      const el = document.getElementById('giveawaysList');
      if (!d.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-gift"></i><p>Sem sorteios.</p></div>'; return; }
      el.innerHTML = d.map(g => `<div class="giveaway-card"><div class="giveaway-info"><h5>🎉 ${g.prize}</h5><span>${g.winners_count} vencedor(es) | Termina: ${new Date(g.ends_at).toLocaleString('pt-PT')}</span></div><span class="giveaway-status ${g.ended ? 'ended' : 'active'}">${g.ended ? 'Terminado' : 'Ativo'}</span></div>`).join('');
    } catch (e) { console.error(e); }
  }

  // STATS
  let charts = {};
  async function loadStats() {
    const guildId = currentGuilds[0]?.id; if (!guildId) return;
    try {
      const r = await fetch(`/api/stats/${guildId}`); const d = await r.json();
      renderChart('chartHourly', 'bar', d.hourly.map(h => `${h.hour}h`), d.hourly.map(h => h.total), 'Mensagens', '#5865F2');
      renderChart('chartDaily', 'line', d.daily.map(d2 => d2.day.substring(5)), d.daily.map(d2 => d2.total), 'Mensagens', '#57F287');
      renderChart('chartTopChannels', 'bar', d.topChannels.map(c => c.name), d.topChannels.map(c => c.total), 'Mensagens', '#FEE75C');
      renderChart('chartMembers', 'line', d.memberHistory.map(m => m.recorded_at?.substring(5, 10) || ''), d.memberHistory.map(m => m.member_count), 'Membros', '#ED4245');
    } catch (e) { console.error(e); }
  }

  function renderChart(canvasId, type, labels, data, label, color) {
    if (charts[canvasId]) charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    charts[canvasId] = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color + '66', borderColor: color, borderWidth: 2, fill: type === 'line', tension: 0.3 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { color: '#949ba4' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#949ba4' }, grid: { display: false } } }
      }
    });
  }

  // TOKEN
  document.getElementById('formBotToken').addEventListener('submit', async e => {
    e.preventDefault();
    const token = getVal('botTokenInput'); if (!token) return showToast('Insere um token!', true);
    await postJson('/api/config', { token });
    showToast('Token guardado! Bot a reiniciar...'); setTimeout(loadAllData, 3000);
  });

  // PRESENCE
  const formPresence = document.getElementById('formPresence');
  if (formPresence) {
    formPresence.addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        status: getVal('presenceStatus'),
        activityType: getVal('presenceType'),
        activityText: getVal('presenceText')
      };
      await postJson('/api/presence', payload);
      showToast('Status atualizado!');
      fetchStatus();
    });
  }

  // WEB SETTINGS
  document.getElementById('formWebSettings').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      botOwners: getVal('webBotOwners').split('\n').map(s => s.trim()).filter(s => s)
    };
    const pw = getVal('webPassword');
    if (pw) payload.password = pw;
    
    await postJson('/api/web-settings', payload);
    showToast('Definições guardadas!');
    setVal('webPassword', '');
  });

  // BACKUP & RESTORE
  const btnBackup = document.getElementById('btnDownloadBackup');
  if (btnBackup) {
    btnBackup.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/backup');
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bot-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Backup descarregado com sucesso!');
      } catch (err) {
        showToast('Erro ao criar backup', true);
      }
    });
  }

  const fileRestore = document.getElementById('fileRestoreBackup');
  if (fileRestore) {
    fileRestore.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const content = JSON.parse(ev.target.result);
          if (!content.config && !content.database) return showToast('Ficheiro de backup inválido', true);
          
          if (confirm('Atenção: Restaurar um backup vai substituir todas as tuas configurações e dados atuais, e reiniciar o bot. Tens a certeza?')) {
            const r = await postJson('/api/restore', content);
            showToast(r.message || 'Restaurado! A reiniciar...');
            setTimeout(() => location.reload(), 3000);
          }
        } catch (err) {
          showToast('Erro ao ler ficheiro de backup', true);
        }
      };
      reader.readAsText(file);
    });
  }

  const formAutoBackup = document.getElementById('formAutoBackup');
  if (formAutoBackup) {
    formAutoBackup.addEventListener('submit', async e => {
      e.preventDefault();
      await postJson('/api/config', { 
        backup: { 
          autoBackup: getChecked('backupAutoEnabled'), 
          channelId: getVal('backupChannelSelect') 
        } 
      });
      showToast('Configurações de backup guardadas!');
    });
  }

  // SLASH COMMANDS
  const btnRegisterCmds = document.getElementById('btnRegisterCommands');
  if (btnRegisterCmds) {
    btnRegisterCmds.addEventListener('click', async () => {
      btnRegisterCmds.disabled = true;
      btnRegisterCmds.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> A registar...';
      const r = await postJson('/api/commands/register', {});
      showToast(r.success ? r.message : (r.error || 'Erro'), !r.success);
      btnRegisterCmds.disabled = false;
      btnRegisterCmds.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Registar Comandos Slash';
    });
  }

  // LOGIN & LOGOUT
  document.getElementById('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await postJson('/api/auth/login', { username: getVal('loginUsername'), password: getVal('loginPassword') });
    if (r.success) {
      document.getElementById('loginModal').classList.add('hidden');
      setVal('loginPassword', '');
      loadAllData();
    } else {
      showToast(r.error || 'Erro no login', true);
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await postJson('/api/auth/logout', {});
    location.reload();
  });

  // REFRESH BUTTON
  document.getElementById('btnRefresh').addEventListener('click', () => { loadAllData(); showToast('Atualizado!'); });

  async function fetchLogs() {
    if (!document.getElementById('tab-dashboard').classList.contains('active')) return;
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      const terminal = document.getElementById('logsTerminal');
      if (terminal && data.length) {
        terminal.innerHTML = data.map(log => {
          let color = '#d4d4d4';
          if (log.type === 'warn') color = '#e8c374';
          if (log.type === 'error') color = '#ed4245';
          const timeStr = new Date(log.time).toLocaleTimeString('pt-PT');
          return `<div style="color: ${color}; margin-bottom: 4px;">[${timeStr}] [${log.type.toUpperCase()}] ${log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
        }).join('');
        // Scroll to bottom
        terminal.scrollTop = terminal.scrollHeight;
      }
    } catch (e) {}
  }

  // POLLING
  setInterval(() => {
    if (document.getElementById('loginModal').classList.contains('hidden')) {
      fetchStatus();
      fetchLogs();
    }
  }, 3000); // Polling faster for logs, 3 seconds

  // HELPERS
  async function postJson(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 401 && !document.getElementById('loginModal').classList.contains('hidden')) {
        return { success: false, error: 'Não autenticado' };
      }
      return await r.json();
    } catch (e) { return { success: false, error: e.message }; }
  }

  // START
  loadAllData();
});
