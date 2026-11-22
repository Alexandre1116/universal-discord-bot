const { REST, Routes } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { loadPlugins, getPluginCommands } = require('../../utils/pluginManager');
const { client } = require('../client');

/**
 * Regista os slash commands de todos os plugins ativos no Discord.
 * @param {string} clientId - ID do bot/client
 * @param {string} token - Token do bot
 */
async function registerCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);

  // Garante que os plugins estão carregados; os comandos dos plugins já
  // carregados são relidos do cache (se não, enviar uma lista vazia apagava
  // todos os comandos registados no Discord).
  loadPlugins(client, null);
  const pluginCommands = getPluginCommands();

  if (pluginCommands.length === 0) {
    throw new Error('Nenhum comando de plugin encontrado. Nenhum comando foi alterado no Discord.');
  }

  const commandJSONs = pluginCommands.map(c => (c.toJSON ? c.toJSON() : c));

  console.log(`[COMMANDS] A registar ${commandJSONs.length} slash commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commandJSONs });
  console.log('[COMMANDS] Slash commands registados com sucesso!');
  return { registered: commandJSONs.length };
}

module.exports = { registerCommands };
