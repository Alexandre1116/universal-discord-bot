const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');

function init(client) {
  console.log('[CUSTOM COMMANDS] Plugin inicializado.');
}

// Normaliza o trigger: aceita ter sido gravado com ou sem prefixo ("!regras" ou "regras")
function stripPrefix(value) {
  return String(value || '').trim().replace(/^[!/?>.]+/, '');
}

function fillTemplate(text, message) {
  return String(text || '')
    .replace(/{user}/g, `<@${message.author.id}>`)
    .replace(/{username}/g, message.author.username)
    .replace(/{server}/g, message.guild.name)
    .replace(/{channel}/g, `#${message.channel.name}`)
    .replace(/{count}/g, String(message.guild.memberCount));
}

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const modules = config.modules || {};
    if (modules.customCommands === false) return;

    const customCommands = config.customCommands || [];
    if (customCommands.length === 0) return;

    const content = message.content.trim();
    if (!content) return;
    const contentNoPrefix = stripPrefix(content);

    for (const cmd of customCommands) {
      const trigger = stripPrefix(cmd.trigger);
      if (!trigger || !cmd.response) continue;

      const matchType = cmd.matchType || 'exact';
      let matched = false;

      try {
        if (matchType === 'regex') {
          matched = new RegExp(trigger, 'i').test(content);
        } else if (matchType === 'startsWith') {
          matched = contentNoPrefix.toLowerCase().startsWith(trigger.toLowerCase());
        } else {
          matched = contentNoPrefix.toLowerCase() === trigger.toLowerCase();
        }
      } catch (err) {
        console.error(`[CUSTOM COMMANDS] Regex inválida no comando "${cmd.trigger}":`, err.message);
        continue;
      }

      if (!matched) continue;

      try {
        if (cmd.type === 'embed') {
          const embed = new EmbedBuilder()
            .setColor(cmd.color || '#5865F2')
            .setDescription(fillTemplate(cmd.response, message))
            .setTimestamp();
          if (cmd.title) embed.setTitle(cmd.title);
          await message.channel.send({ embeds: [embed] });
        } else {
          await message.channel.send({ content: fillTemplate(cmd.response, message) });
        }
      } catch (err) {
        console.error('[CUSTOM COMMANDS] Erro ao executar comando personalizado:', err.message);
      }
      break;
    }
  }
};

module.exports = { init, events };
