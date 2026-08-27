const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');

function init(client) {
  console.log('[CUSTOM COMMANDS] Plugin inicializado.');
}

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const modules = config.modules || {};
    if (modules.customCommands === false) return;

    const customCommands = config.customCommands || [];
    if (customCommands.length === 0) return;

    const prefix = '!';

    for (const cmd of customCommands) {
      const trigger = `${prefix}${cmd.trigger}`;
      if (message.content.trim().toLowerCase() === trigger.toLowerCase()) {
        try {
          if (cmd.type === 'embed') {
            const embed = new EmbedBuilder()
              .setColor(cmd.color || '#5865F2')
              .setDescription(cmd.response)
              .setTimestamp();
            if (cmd.title) embed.setTitle(cmd.title);
            await message.channel.send({ embeds: [embed] });
          } else {
            await message.channel.send(cmd.response);
          }
        } catch (err) {
          console.error('[CUSTOM COMMANDS] Erro ao executar comando personalizado:', err.message);
        }
        break;
      }
    }
  }
};

module.exports = { init, events };
