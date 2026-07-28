const { recordMessageStat } = require('../../utils/database');

module.exports = function registerMessageCreate(client) {
  client.on('messageCreate', async (message) => {
    // Ignorar bots e DMs
    if (message.author.bot || !message.guild) return;

    // --- ESTATÍSTICAS NATIVAS DO CORE ---
    try {
      recordMessageStat(message.guild.id, message.channel.id, message.author.id);
    } catch (err) {
      // Silenciar erros de stats para não afetar o bot
    }
  });
};
