const { REST, Routes } = require('discord.js');
const { getConfig } = require('../../utils/config');
const { loadPlugins } = require('../../utils/pluginManager');
const { client } = require('../client');

/**
 * Regista os slash commands de todos os plugins ativos no Discord.
 * @param {string} clientId - ID do bot/client
 * @param {string} token - Token do bot
 */
async function registerCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  const pluginCommands = loadPlugins(client, null);
  const commandJSONs = pluginCommands.map(c => (c.toJSON ? c.toJSON() : c));

  console.log(`[COMMANDS] A registar ${commandJSONs.length} slash commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commandJSONs });
  console.log('[COMMANDS] Slash commands registados com sucesso!');
}

module.exports = { registerCommands };
