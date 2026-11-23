const { REST, Routes } = require('discord.js');
const { getPluginCommands } = require('../../utils/pluginManager');

/**
 * Regista os slash commands de todos os plugins ativos no Discord.
 * @param {string} clientId - ID do bot/client
 * @param {string} token - Token do bot
 */
async function registerCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);

  // Lê os comandos dos plugins já carregados pelo arranque. Não volta a chamar
  // loadPlugins: essa via carregaria eventos e plugins sem router de rotas.
  const pluginCommands = getPluginCommands();

  if (pluginCommands.length === 0) {
    throw new Error('Nenhum comando de plugin encontrado. Nenhum comando foi alterado no Discord (arranca o bot ou ativa plugins primeiro).');
  }

  const commandJSONs = pluginCommands.map(c => (c.toJSON ? c.toJSON() : c));

  console.log(`[COMMANDS] A registar ${commandJSONs.length} slash commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commandJSONs });
  console.log('[COMMANDS] Slash commands registados com sucesso!');
  return { registered: commandJSONs.length };
}

module.exports = { registerCommands };
