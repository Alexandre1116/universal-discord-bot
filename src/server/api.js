const express = require('express');
const { EmbedBuilder } = require('discord.js');
const { getConfig, updateConfig, saveConfig } = require('../utils/config');
const { client, getBotStatus, initBot } = require('../bot/client');
const fs = require('fs');
const path = require('path');
const { getInstalledPlugins, installPluginFromGithub, deletePlugin, USER_PLUGINS_DIR, OFFICIAL_PLUGINS_DIR } = require('../utils/pluginManager');

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
  updateConfig({ plugins: config.plugins });
  res.json({ success: true });
});

router.delete('/plugins/:id', (req, res) => {
  const result = deletePlugin(req.params.id);
  res.json(result);
});

// Servir ficheiros estáticos da pasta ui/ dos plugins (tab.html, script.js)
router.use('/plugins-ui', express.static(USER_PLUGINS_DIR), express.static(OFFICIAL_PLUGINS_DIR));

// GET /api/status - Status do bot
router.get('/status', (req, res) => {
  res.json(getBotStatus());
});

// GET /api/config - Configurações atuais
router.get('/config', (req, res) => {
  const config = getConfig();
  // Esconder token parcialmente para segurança
  const safeConfig = {
    ...config,
    token: config.token ? `••••••••••••${config.token.slice(-4)}` : ''
  };
  res.json(safeConfig);
});

// POST /api/config - Atualizar configurações
router.post('/config', (req, res) => {
  try {
    const currentConfig = getConfig();
    const { token, joinMessage, leaveMessage, voiceHubs } = req.body;

    const updates = {};

    if (joinMessage) updates.joinMessage = { ...currentConfig.joinMessage, ...joinMessage };
    if (leaveMessage) updates.leaveMessage = { ...currentConfig.leaveMessage, ...leaveMessage };
    if (voiceHubs) updates.voiceHubs = voiceHubs;

    if (token && token.trim() !== '' && !token.includes('••••')) {
      updates.token = token.trim();
      process.env.DISCORD_TOKEN = token.trim();
      // Tentar reiniciar o bot com o novo token
      client.destroy().then(() => {
        initBot();
      }).catch(() => {
        initBot();
      });
    }

    const updated = updateConfig(updates);
    res.json({ success: true, config: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/presence - Atualizar status do bot
router.post('/presence', (req, res) => {
  try {
    const { status, activityType, activityText } = req.body;
    const updates = { presence: { status, activityType, activityText } };
    updateConfig(updates);
    
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

    updateConfig({ voiceHubs });
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
    updateConfig({ voiceHubs });
    res.json({ success: true, voiceHubs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
