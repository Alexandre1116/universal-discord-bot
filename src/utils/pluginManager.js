const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getConfig, updateConfig } = require('./config');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'data', 'plugins');

// Garantir que a pasta plugins existe
if (!fs.existsSync(PLUGINS_DIR)) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

function getInstalledPlugins() {
  const plugins = [];
  const folders = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

  for (const folder of folders) {
    if (folder.isDirectory()) {
      const pluginPath = path.join(PLUGINS_DIR, folder.name);
      const metaPath = path.join(pluginPath, 'plugin.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          meta.folderId = folder.name;
          plugins.push(meta);
        } catch (e) {
          console.error(`[PLUGIN MANAGER] Erro ao ler plugin.json do plugin ${folder.name}:`, e.message);
        }
      }
    }
  }
  return plugins;
}

function installPluginFromGithub(url) {
  try {
    // 1. Validar URL básico
    if (!url.startsWith('https://github.com/')) {
      throw new Error('URL inválido. Tem de ser um repositório GitHub (https://github.com/...)');
    }

    // 2. Extrair nome do repo para usar como nome da pasta
    const parts = url.split('/');
    let repoName = parts[parts.length - 1];
    if (repoName.endsWith('.git')) repoName = repoName.slice(0, -4);

    const pluginPath = path.join(PLUGINS_DIR, repoName);

    // 3. Clonar repositório
    if (fs.existsSync(pluginPath)) {
      throw new Error(`Um plugin com a pasta '${repoName}' já existe.`);
    }

    console.log(`[PLUGIN MANAGER] A clonar repositório: ${url}`);
    execSync(`git clone ${url} "${pluginPath}"`, { stdio: 'inherit' });

    // 4. Instalar dependências se houver package.json
    const packagePath = path.join(pluginPath, 'package.json');
    if (fs.existsSync(packagePath)) {
      console.log(`[PLUGIN MANAGER] A instalar dependências para o plugin ${repoName}...`);
      execSync('npm install', { cwd: pluginPath, stdio: 'inherit' });
    }

    // 5. Validar se existe plugin.json
    if (!fs.existsSync(path.join(pluginPath, 'plugin.json'))) {
      // Se não existir, remover a pasta
      fs.rmSync(pluginPath, { recursive: true, force: true });
      throw new Error(`Repositório não parece ser um plugin compatível (falta plugin.json).`);
    }

    // Ativar o plugin automaticamente
    const config = getConfig();
    if (!config.plugins) config.plugins = {};
    config.plugins[repoName] = true;
    updateConfig({ plugins: config.plugins });

    return { success: true, pluginId: repoName };
  } catch (error) {
    console.error(`[PLUGIN MANAGER] Falha ao instalar plugin:`, error.message);
    return { success: false, error: error.message };
  }
}

function deletePlugin(pluginId) {
  try {
    const pluginPath = path.join(PLUGINS_DIR, pluginId);
    if (fs.existsSync(pluginPath)) {
      fs.rmSync(pluginPath, { recursive: true, force: true });
      return { success: true };
    }
    return { success: false, error: 'Plugin não encontrado' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Retorna plugins ativados
function getActivePlugins() {
  const config = getConfig();
  const pluginsState = config.plugins || {};
  return getInstalledPlugins().filter(p => pluginsState[p.folderId] !== false);
}

// Carrega a lógica dos plugins
function loadPlugins(client, app) {
  const activePlugins = getActivePlugins();
  let allCommands = [];

  for (const plugin of activePlugins) {
    try {
      const pluginPath = path.join(PLUGINS_DIR, plugin.folderId, 'index.js');
      if (fs.existsSync(pluginPath)) {
        const logic = require(pluginPath);
        
        if (logic.init) logic.init(client);
        
        if (logic.events) {
          for (const [eventName, handler] of Object.entries(logic.events)) {
            client.on(eventName, (...args) => handler(client, ...args));
          }
        }
        
        if (logic.commands) {
          allCommands = allCommands.concat(logic.commands);
        }

        if (logic.routes && app) {
          logic.routes(app);
        }
        console.log(`[PLUGIN MANAGER] Plugin '${plugin.name}' carregado.`);
      }
    } catch (e) {
      console.error(`[PLUGIN MANAGER] Erro ao carregar plugin ${plugin.folderId}:`, e.message);
    }
  }
  return allCommands;
}

module.exports = {
  getInstalledPlugins,
  installPluginFromGithub,
  getActivePlugins,
  deletePlugin,
  loadPlugins,
  PLUGINS_DIR
};
