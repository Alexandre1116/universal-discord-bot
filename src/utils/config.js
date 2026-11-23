const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
// Parceiro do DB_PATH: permite à verificação automática trabalhar numa pasta de
// testes em vez de criar/alterar o data/config.json real
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(DATA_DIR, 'config.json');
const OLD_CONFIG_PATH = path.join(__dirname, '../../config.json');

// Assegurar que a pasta data existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Migrar o config.json antigo (raiz do projeto) para a nova pasta, se existir.
// Só no modo por omissão: com CONFIG_PATH apontado para outro lado (ex.: verify),
// não queremos mover ficheiros reais para uma sandbox que depois é apagada.
if (!process.env.CONFIG_PATH && fs.existsSync(OLD_CONFIG_PATH) && !fs.existsSync(CONFIG_PATH)) {
  fs.renameSync(OLD_CONFIG_PATH, CONFIG_PATH);
}

const defaultConfig = {
  token: process.env.DISCORD_TOKEN || '',
  joinMessage: {
    enabled: true,
    channelId: '',
    messageType: 'embed',
    content: 'Bem-vindo(a) ao servidor, {user}! 🎉 Esperamos que te divirtas por cá!',
    embedTitle: '👋 Novo Membro!',
    embedColor: '#5865F2',
    showAvatar: true,
    generateImage: false,
    imageBackgroundUrl: ''
  },
  leaveMessage: {
    enabled: true,
    channelId: '',
    messageType: 'embed',
    content: 'O membro {user} saiu do servidor. 😢 Agora somos {count} membros.',
    embedTitle: '🚪 Membro Saiu',
    embedColor: '#ED4245',
    showAvatar: true
  },
  voiceHubs: [],
  tempChannels: [],
  botOwners: [],
  webAuth: null,
  presence: {
    status: 'online',
    activityType: 'Playing',
    activityText: 'Discord Bot'
  },
  customCommands: [],
  backup: {
    autoBackup: false,
    channelId: ''
  },
  notifications: {
    youtube: [],
    twitch: []
  },
  modules: {
    moderation: true,
    utility: true,
    levels: true,
    reactionRoles: true,
    giveaway: true,
    tickets: true,
    welcome: true,
    customCommands: true,
    music: true,
    notifications: true
  }
};

function generateRandomPassword(length = 12) {
  // crypto.randomInt (não Math.random): a password gerada no primeiro arranque é
  // a credencial do painel de administração
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
  const crypto = require('crypto');
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(crypto.randomInt(chars.length));
  }
  return pass;
}

let lastGoodConfig = null; // última leitura bem-sucedida (evita escrever predefinições por cima)
let readFailed = false;

// O logger da aplicação intercepta console.* e guarda as últimas 100 mensagens,
// que o painel expõe em /api/logs. A password gerada não pode passar por aí:
// vai direitamento ao stdout (o operador vê-a no terminal) sem entrar no anel.
function printGeneratedCredentials(cfg) {
  const banner = [
    '==================================================',
    '🔒 CREDENCIAIS GERADAS PARA O PAINEL WEB 🔒',
    `👤 Username: ${cfg.webAuth.username}`,
    `🔑 Password: ${cfg.webAuth.password}`,
    '=================================================='
  ].join('\n');
  process.stdout.write(banner + '\n');
}

function getConfig() {
  try {
    let currentConfig = { ...defaultConfig };
    if (!fs.existsSync(CONFIG_PATH)) {
      // Primeiro arranque (clone/download recente): não há config no repositório,
      // por isso nasce um limpo com credenciais próprias. WEB_AUTH_USERNAME /
      // WEB_AUTH_PASSWORD permitem defini-las à partida em Docker/headless.
      // Se já tínhamos uma config válida em memória (o ficheiro desapareceu
      // com o processo vivo — git pull/checkout com o bot a correr, remount),
      // não a substituímos por uma nova: repomos a conhecida.
      if (lastGoodConfig) {
        console.error(`[CONFIG] ${CONFIG_PATH} desapareceu; a repor a última configuração conhecida em memória.`);
        try { saveConfig(lastGoodConfig); } catch (err) { console.error('[CONFIG] Falha ao repor:', err.message); }
        readFailed = false;
        return lastGoodConfig;
      }

      const usernameFromEnv = String(process.env.WEB_AUTH_USERNAME || '').trim();
      const rawPasswordEnv = String(process.env.WEB_AUTH_PASSWORD || '').trim();
      let passwordFromEnv = rawPasswordEnv;
      if (rawPasswordEnv && rawPasswordEnv.length < 8) {
        console.warn('[CONFIG] WEB_AUTH_PASSWORD com menos de 8 caracteres; a ignorar e a gerar uma aleatória.');
        passwordFromEnv = '';
      }
      const generatedUsername = usernameFromEnv || 'admin';
      const generatedPassword = passwordFromEnv || generateRandomPassword();
      const generated = !passwordFromEnv;

      currentConfig.webAuth = { username: generatedUsername, password: generatedPassword };
      const saved = saveConfig(currentConfig);
      if (!saved) {
        console.error(`[CONFIG] Falha ao gravar ${CONFIG_PATH}: credenciais não persistidas. Verifica permissões do directório.`);
        readFailed = true;
        return currentConfig;
      }
      if (generated) printGeneratedCredentials(currentConfig);
      lastGoodConfig = currentConfig;
      readFailed = false;
      return currentConfig;
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    // Ficheiro vazio: trata-se como "não existe" para não ficar preso num JSON
    // inválido para sempre (caso comum ao criar o ficheiro à mão).
    if (data.trim() === '') {
      if (lastGoodConfig) {
        console.error(`[CONFIG] ${CONFIG_PATH} vazio; a repor a última configuração conhecida em memória.`);
        try { saveConfig(lastGoodConfig); } catch (err) { console.error('[CONFIG] Falha ao repor:', err.message); }
        readFailed = false;
        return lastGoodConfig;
      }
      const usernameFromEnv = String(process.env.WEB_AUTH_USERNAME || '').trim();
      const rawPasswordEnv = String(process.env.WEB_AUTH_PASSWORD || '').trim();
      let passwordFromEnv = rawPasswordEnv;
      if (rawPasswordEnv && rawPasswordEnv.length < 8) {
        console.warn('[CONFIG] WEB_AUTH_PASSWORD com menos de 8 caracteres; a ignorar e a gerar uma aleatória.');
        passwordFromEnv = '';
      }
      const generatedUsername = usernameFromEnv || 'admin';
      const generatedPassword = passwordFromEnv || generateRandomPassword();
      const generated = !passwordFromEnv;
      currentConfig.webAuth = { username: generatedUsername, password: generatedPassword };
      const saved = saveConfig(currentConfig);
      if (!saved) {
        console.error(`[CONFIG] Falha ao gravar ${CONFIG_PATH}: credenciais não persistidas.`);
        readFailed = true;
        return currentConfig;
      }
      if (generated) printGeneratedCredentials(currentConfig);
      lastGoodConfig = currentConfig;
      readFailed = false;
      return currentConfig;
    }
    const parsed = JSON.parse(data);
    // Um JSON válido mas com a raiz errada (array, string, número) não pode ser
    // tratado como config: acabaria por gravar predefinições (e uma password nova)
    // por cima do ficheiro real
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('config.json não contém um objeto JSON válido.');
    }
    currentConfig = { ...defaultConfig, ...parsed };

    if (!currentConfig.webAuth) {
      const usernameFromEnv = String(process.env.WEB_AUTH_USERNAME || '').trim();
      const rawPasswordEnv = String(process.env.WEB_AUTH_PASSWORD || '').trim();
      let passwordFromEnv = rawPasswordEnv;
      if (rawPasswordEnv && rawPasswordEnv.length < 8) {
        console.warn('[CONFIG] WEB_AUTH_PASSWORD com menos de 8 caracteres; a ignorar e a gerar uma aleatória.');
        passwordFromEnv = '';
      }
      const generatedUsername = usernameFromEnv || 'admin';
      const generatedPassword = passwordFromEnv || generateRandomPassword();
      const generated = !passwordFromEnv;

      currentConfig.webAuth = { username: generatedUsername, password: generatedPassword };
      const saved = saveConfig(currentConfig);
      if (!saved) {
        console.error(`[CONFIG] Falha ao gravar ${CONFIG_PATH}: credenciais não persistidas.`);
        readFailed = true;
        return lastGoodConfig || currentConfig;
      }
      if (generated) printGeneratedCredentials(currentConfig);
      lastGoodConfig = currentConfig;
      readFailed = false;
    } else {
      readFailed = false;
      lastGoodConfig = currentConfig;
    }
    return currentConfig;
  } catch (error) {
    // Um config.json corrompido não pode fazer as alterações seguintes gravarem
    // as predefinições (token vazio, sem webAuth) por cima do ficheiro real
    readFailed = true;
    console.error('Erro ao ler config.json:', error.message);
    if (lastGoodConfig) {
      console.error('[CONFIG] A usar a última configuração conhecida em memória.');
      return lastGoodConfig;
    }
    return defaultConfig;
  }
}

function saveConfig(newConfig) {
  try {
    // Escrita atómica: escreve num temporário e troca com rename, para nunca
    // deixar um config.json a meio (pedido de restauro/queda no meio da escrita)
    const tmpPath = `${CONFIG_PATH}.tmp`;
    // 0600: só o dono lê/escreve — o ficheiro contém token, password do painel
    // e sessionSecret. O rename preserva o modo do ficheiro temporário.
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, CONFIG_PATH);
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (err) { /* plataformas sem chmod */ }
    // A cópia de segurança em memória tem de ser ESTA configuração: sem isto, o
    // plano "gravar a última conhecida" pode repor valores antigos
    lastGoodConfig = newConfig;
    return true;
  } catch (error) {
    console.error('Erro ao guardar config.json:', error);
    return false;
  }
}

function updateConfig(updates) {
  // Ler PRIMEIRO e decidir depois: com um config.json ilegível, uma primeira
  // chamada direta a updateConfig() chegava a gravar as predefinições (token
  // vazio, password nova) por cima do ficheiro real
  const current = getConfig();
  if (readFailed) {
    if (!lastGoodConfig) {
      console.error('[CONFIG] config.json ilegível e sem cópia em memória: nenhuma alteração gravada (evita apagar a configuração).');
      return null;
    }
    console.error('[CONFIG] config.json ilegível; a gravar a partir da última configuração conhecida em memória — verifica o ficheiro.');
  }
  const merged = { ...current, ...updates };
  if (!saveConfig(merged)) {
    console.error('[CONFIG] Falha ao gravar as alterações no disco.');
    return null;
  }
  return merged;
}

module.exports = {
  getConfig,
  saveConfig,
  updateConfig
};
