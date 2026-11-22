const express = require('express');
const { EmbedBuilder } = require('discord.js');
const { getConfig, updateConfig, saveConfig } = require('../utils/config');
const { client, getBotStatus, initBot } = require('../bot/client');
const fs = require('fs');
const path = require('path');
const { getInstalledPlugins, installPluginFromGithub, deletePlugin, getPluginPath } = require('../utils/pluginManager');

const router = express.Router();

// --- PLUGINS API ---
router.get('/plugins', (req, res) => {
  const plugins = getInstalledPlugins();
  const config = getConfig();
  const pluginsState = config.plugins || {};
  
  // Anexar estado atual (ativado/desativado)
  const result = plugins.map(p => ({
    ...p,
    enabled: pluginsState[p.folderId] !== false
  }));
  res.json(result);
});

router.post('/plugins/install', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
  
  const result = installPluginFromGithub(url);
  if (result.success) {
    res.json({ success: true, message: 'Plugin instalado. O bot deve ser reiniciado para o carregar.' });
  } else {
    res.status(400).json(result);
  }
});

router.post('/plugins/toggle', (req, res) => {
  const { pluginId, enabled } = req.body;
  const config = getConfig();
  if (!config.plugins) config.plugins = {};
  config.plugins[pluginId] = enabled;
  if (!updateConfig({ plugins: config.plugins })) {
    return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
  }
  res.json({ success: true });
});

router.delete('/plugins/:id', (req, res) => {
  const result = deletePlugin(req.params.id);
  res.json(result);
});

// Serve APENAS a pasta ui/ dos plugins instalados. Antes, express.static nas
// raízes de data/plugins e plugins/ expunha index.js, plugin.json e
// node_modules de qualquer plugin a quem tivesse sessão no painel.
const PLUGIN_ID_RE = /^[A-Za-z0-9._-]+$/;

router.get('/plugins-ui/:folderId/ui/:asset(*)', (req, res) => {
  try {
    const folderId = req.params.folderId;
    if (!PLUGIN_ID_RE.test(folderId) || folderId === '..' || folderId === '.') {
      return res.status(400).json({ success: false, error: 'Identificador de plugin inválido.' });
    }

    const base = getPluginPath(folderId);
    if (!base) return res.status(404).json({ success: false, error: 'Plugin não encontrado.' });

    const uiDir = path.resolve(base, 'ui');
    const target = path.resolve(uiDir, req.params.asset || '');
    if (target !== uiDir && !target.startsWith(uiDir + path.sep)) {
      return res.status(403).json({ success: false, error: 'Caminho fora da pasta ui/ do plugin.' });
    }

    // realpath: bloqueia links simbólicos que apontem para fora da pasta ui/
    let realUiDir, realTarget;
    try {
      realUiDir = fs.realpathSync(uiDir);
      realTarget = fs.realpathSync(target);
    } catch (err) {
      return res.status(404).json({ success: false, error: 'Ficheiro não encontrado.' });
    }
    if (realTarget !== realUiDir && !realTarget.startsWith(realUiDir + path.sep)) {
      return res.status(403).json({ success: false, error: 'Caminho fora da pasta ui/ do plugin.' });
    }
    if (!fs.statSync(realTarget).isFile()) {
      return res.status(404).json({ success: false, error: 'Ficheiro não encontrado.' });
    }
    res.sendFile(realTarget);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/status - Status do bot
router.get('/status', (req, res) => {
  res.json(getBotStatus());
});

// GET /api/config - Configurações atuais
router.get('/config', (req, res) => {
  const config = getConfig();
  // Esconder segredos: o token mascarado e as credenciais do painel / session
  // secret nunca saem para o browser (a cópia integral continua em /api/backup)
  const safeConfig = {
    ...config,
    token: config.token ? `••••••••••••${config.token.slice(-4)}` : '',
    webAuth: config.webAuth ? { username: config.webAuth.username, password: '••••••••' } : null,
    sessionSecret: undefined
  };
  res.json(safeConfig);
});

// POST /api/config - Atualizar configurações
router.post('/config', (req, res) => {
  try {
    const currentConfig = getConfig();
    const { token, joinMessage, leaveMessage, voiceHubs, backup } = req.body;

    const updates = {};

    if (joinMessage) updates.joinMessage = { ...currentConfig.joinMessage, ...joinMessage };
    if (leaveMessage) updates.leaveMessage = { ...currentConfig.leaveMessage, ...leaveMessage };
    if (voiceHubs) updates.voiceHubs = voiceHubs;
    if (backup) updates.backup = { ...(currentConfig.backup || {}), ...backup };

    if (token && token.trim() !== '' && !token.includes('••••')) {
      updates.token = token.trim();
    }

    const updated = updateConfig(updates);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
    }

    // O ambiente só muda com a gravação confirmada (senão um 500 deixava o
    // processo com um token que não está em lado nenhum persistente)
    if (updates.token) {
      process.env.DISCORD_TOKEN = updates.token;
    }

    if (updates.token) {
      // Reinicia o bot só depois de o token estar gravado
      client.destroy().then(() => {
        initBot();
      }).catch(() => {
        initBot();
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/presence - Atualizar status do bot
router.post('/presence', (req, res) => {
  try {
    const { status, activityType, activityText } = req.body;
    const updates = { presence: { status, activityType, activityText } };
    if (!updateConfig(updates)) {
      return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
    }
    
    if (client.user) {
      const typeMap = {
        'Playing': 0,
        'Streaming': 1,
        'Listening': 2,
        'Watching': 3,
        'Custom': 4,
        'Competing': 5
      };
      
      client.user.setPresence({
        status: status || 'online',
        activities: activityText ? [{
          name: activityText,
          type: typeMap[activityType] || 0
        }] : []
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/guilds - Lista de servidores e canais para preenchimento automático
router.get('/guilds', (req, res) => {
  if (!client.user) {
    return res.json({ ready: false, guilds: [] });
  }

  const guildsData = client.guilds.cache.map(guild => {
    const textChannels = guild.channels.cache
      .filter(c => c.isTextBased())
      .map(c => ({ id: c.id, name: c.name, category: c.parent ? c.parent.name : null }));

    const voiceChannels = guild.channels.cache
      .filter(c => c.isVoiceBased())
      .map(c => ({ 
        id: c.id, 
        name: c.name, 
        userLimit: c.userLimit,
        bitrate: c.bitrate,
        category: c.parent ? c.parent.name : null 
      }));

    return {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
      textChannels,
      voiceChannels
    };
  });

  res.json({ ready: true, guilds: guildsData });
});

// POST /api/test-message - Testar envio de mensagem de Entrada ou Saída
router.post('/test-message', async (req, res) => {
  try {
    const { type, channelId } = req.body;
    const config = getConfig();

    if (!channelId) {
      return res.status(400).json({ success: false, error: 'ID do canal não fornecido.' });
    }

    const channel = client.channels.cache.get(channelId) || 
                    await client.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ success: false, error: 'Canal de texto não encontrado ou inacessível pelo bot.' });
    }

    const isJoin = type === 'join';
    const msgConfig = isJoin ? config.joinMessage : config.leaveMessage;

    const sampleUser = client.user;
    const sampleGuild = channel.guild;

    const formattedContent = (msgConfig.content || 'Mensagem de Teste!')
      .replace(/{user}/g, `<@${sampleUser.id}>`)
      .replace(/{username}/g, sampleUser.username)
      .replace(/{server}/g, sampleGuild.name)
      .replace(/{count}/g, sampleGuild.memberCount.toString());

    if (msgConfig.messageType === 'embed') {
      const embed = new EmbedBuilder()
        .setTitle(`[TESTE] ${msgConfig.embedTitle || (isJoin ? '👋 Novo Membro!' : '🚪 Membro Saiu')}`)
        .setDescription(formattedContent)
        .setColor(msgConfig.embedColor || (isJoin ? '#5865F2' : '#ED4245'))
        .setTimestamp();

      if (msgConfig.showAvatar) {
        embed.setThumbnail(sampleUser.displayAvatarURL({ dynamic: true, size: 256 }));
      }

      await channel.send({ embeds: [embed] });
    } else {
      await channel.send({ content: `[TESTE] ${formattedContent}` });
    }

    res.json({ success: true, message: 'Mensagem de teste enviada com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/hubs - Adicionar novo canal de voz Hub
router.post('/hubs', (req, res) => {
  try {
    const { channelId, namePattern, userLimit } = req.body;
    if (!channelId) {
      return res.status(400).json({ success: false, error: 'ID do canal Hub é obrigatório.' });
    }

    const config = getConfig();
    const voiceHubs = config.voiceHubs || [];

    const existingIndex = voiceHubs.findIndex(h => h.channelId === channelId);
    const hubItem = {
      id: existingIndex >= 0 ? voiceHubs[existingIndex].id : `hub_${Date.now()}`,
      channelId,
      namePattern: namePattern || '🔊 {user}',
      userLimit: parseInt(userLimit, 10) || 0,
      createdAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      voiceHubs[existingIndex] = hubItem;
    } else {
      voiceHubs.push(hubItem);
    }

    if (!updateConfig({ voiceHubs })) {
      return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
    }
    res.json({ success: true, voiceHubs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/hubs/:id - Remover canal Hub
router.delete('/hubs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const config = getConfig();
    let voiceHubs = config.voiceHubs || [];
    voiceHubs = voiceHubs.filter(h => h.id !== id && h.channelId !== id);
    if (!updateConfig({ voiceHubs })) {
      return res.status(500).json({ success: false, error: 'Falha ao gravar a configuração em disco.' });
    }
    res.json({ success: true, voiceHubs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
