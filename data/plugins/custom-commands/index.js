const path = require('path');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');
const { getConfig } = require(configPath);

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const customCommands = config.customCommands || [];
    const messageContent = message.content.trim();

    for (const cmd of customCommands) {
      if (
        (cmd.matchType === 'exact' && messageContent.toLowerCase() === cmd.trigger.toLowerCase()) ||
        (cmd.matchType === 'startsWith' && messageContent.toLowerCase().startsWith(cmd.trigger.toLowerCase())) ||
        (!cmd.matchType && messageContent.toLowerCase() === cmd.trigger.toLowerCase())
      ) {
        try {
          await message.channel.send({ content: cmd.response });
          return;
        } catch (e) {
          console.error('[CUSTOM COMMANDS] Erro ao enviar resposta:', e.message);
        }
      }
    }
  }
};

module.exports = {
  events
};
