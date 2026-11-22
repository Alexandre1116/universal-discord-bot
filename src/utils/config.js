const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const OLD_CONFIG_PATH = path.join(__dirname, '../../config.json');

// Assegurar que a pasta data existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Migrar o config.json antigo para a nova pasta se necessário
if (fs.existsSync(OLD_CONFIG_PATH) && !fs.existsSync(CONFIG_PATH)) {
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
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

let lastGoodConfig = null; // última leitura bem-sucedida (evita escrever predefinições por cima)
let readFailed = false;

function getConfig() {
  try {
    let currentConfig = { ...defaultConfig };
    if (!fs.existsSync(CONFIG_PATH)) {
      currentConfig.webAuth = { username: 'admin', password: generateRandomPassword() };
      saveConfig(currentConfig);
      console.log('==================================================');
      console.log('🔒 CREDENCIAIS GERADAS PARA O PAINEL WEB 🔒');
      console.log(`👤 Username: ${currentConfig.webAuth.username}`);
      console.log(`🔑 Password: ${currentConfig.webAuth.password}`);
      console.log('==================================================');
      lastGoodConfig = currentConfig;
      return currentConfig;
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(data);
    currentConfig = { ...defaultConfig, ...parsed };

    if (!currentConfig.webAuth) {
      currentConfig.webAuth = { username: 'admin', password: generateRandomPassword() };
      saveConfig(currentConfig);
      console.log('==================================================');
      console.log('🔒 CREDENCIAIS GERADAS PARA O PAINEL WEB 🔒');
      console.log(`👤 Username: ${currentConfig.webAuth.username}`);
      console.log(`🔑 Password: ${currentConfig.webAuth.password}`);
      console.log('==================================================');
    }
    readFailed = false;
    lastGoodConfig = currentConfig;
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
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONFIG_PATH);
    return true;
  } catch (error) {
    console.error('Erro ao guardar config.json:', error);
    return false;
  }
}

function updateConfig(updates) {
  if (readFailed && !lastGoodConfig) {
    console.error('[CONFIG] config.json ilegível e sem cópia em memória: nenhuma alteração gravada (evita apagar a configuração).');
    return null;
  }
  const current = getConfig();
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
