const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');

const PREFIX = '!';

function init(client) {
  console.log('[CUSTOM COMMANDS] Plugin inicializado.');
}

// Normaliza APENAS o prefixo duplicado: um trigger gravado como "!regras" deixa
// de ser comparado como "!!regras". A exigência do prefixo mantém-se — sem ela,
// palavras normais de conversa passariam a disparar auto-respostas.
function normalizeTrigger(value) {
  return String(value || '').trim().replace(/^!+/, '');
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
    if (!content.startsWith(PREFIX)) return; // o prefixo é obrigatório

    const contentWithoutPrefix = content.slice(PREFIX.length).trim();

    for (const cmd of customCommands) {
      if (!cmd.trigger || !cmd.response) continue;

      const matchType = cmd.matchType || 'exact';
      // Em regex usa-se o padrão TAL COMO foi gravado (remover o prefixo
      // corrompia padrões como ".*promo"). NOTA: o padrão é testado sobre o
      // conteúdo JÁ SEM o prefixo "!" — escrever "^help", não "^!help".
      const rawTrigger = String(cmd.trigger).trim();
      const trigger = matchType === 'regex' ? rawTrigger : normalizeTrigger(rawTrigger);
      if (!trigger) continue;

      let matched = false;
      try {
        if (matchType === 'regex') {
          matched = new RegExp(trigger, 'i').test(contentWithoutPrefix);
        } else if (matchType === 'startsWith') {
          matched = contentWithoutPrefix.toLowerCase().startsWith(trigger.toLowerCase());
        } else {
          matched = contentWithoutPrefix.toLowerCase() === trigger.toLowerCase();
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
