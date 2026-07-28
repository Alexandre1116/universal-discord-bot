const { handleBan, handleKick, handleMute, handleUnmute, handleWarn, handleWarnings, handleClearWarnings } = require('../commands/moderation');
const { handleServerInfo, handleUserInfo, handleAvatar, handlePoll } = require('../commands/utility');
const { handleRank, handleLeaderboard } = require('../commands/levels');
const { handleGiveawayStart, handleGiveawayEnd, handleGiveawayReroll, handleGiveawayButton } = require('../commands/giveaway');
const { handleTicketSetup, handleTicketOpen, handleTicketClose, handleTicketTranscript } = require('../commands/tickets');
const { execute: handleMusic } = require('../commands/music');
const { getConfig } = require('../../utils/config');

module.exports = function registerInteractionCreate(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      const config = getConfig();
      const modules = config.modules || {};

      // --- SLASH COMMANDS ---
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          // Música
          case 'play':
          case 'skip':
          case 'stop':
          case 'queue':
          case 'volume':
            if (modules.music === false) return interaction.reply({ content: '❌ O módulo de **Música** está desativado.', ephemeral: true });
            return await handleMusic(interaction, client);
          
          // Moderação
          case 'ban': 
          case 'kick': 
          case 'mute': 
          case 'unmute': 
          case 'warn': 
          case 'warnings': 
          case 'clearwarnings': 
            if (modules.moderation === false) return interaction.reply({ content: '❌ O módulo de **Moderação** está desativado.', ephemeral: true });
            if (interaction.commandName === 'ban') return await handleBan(interaction);
            if (interaction.commandName === 'kick') return await handleKick(interaction);
            if (interaction.commandName === 'mute') return await handleMute(interaction);
            if (interaction.commandName === 'unmute') return await handleUnmute(interaction);
            if (interaction.commandName === 'warn') return await handleWarn(interaction);
            if (interaction.commandName === 'warnings') return await handleWarnings(interaction);
            if (interaction.commandName === 'clearwarnings') return await handleClearWarnings(interaction);
            break;

          // Utilidade
          case 'serverinfo': 
          case 'userinfo': 
          case 'avatar': 
          case 'poll': 
            if (modules.utility === false) return interaction.reply({ content: '❌ O módulo de **Utilidade** está desativado.', ephemeral: true });
            if (interaction.commandName === 'serverinfo') return await handleServerInfo(interaction);
            if (interaction.commandName === 'userinfo') return await handleUserInfo(interaction);
            if (interaction.commandName === 'avatar') return await handleAvatar(interaction);
            if (interaction.commandName === 'poll') return await handlePoll(interaction);
            break;

          // Níveis
          case 'rank': 
          case 'leaderboard': 
            if (modules.levels === false) return interaction.reply({ content: '❌ O módulo de **Níveis** está desativado.', ephemeral: true });
            if (interaction.commandName === 'rank') return await handleRank(interaction);
            if (interaction.commandName === 'leaderboard') return await handleLeaderboard(interaction);
            break;

          // Giveaway
          case 'giveaway':
            if (modules.giveaway === false) return interaction.reply({ content: '❌ O módulo de **Sorteios (Giveaways)** está desativado.', ephemeral: true });
            const sub = interaction.options.getSubcommand();
            if (sub === 'start') return await handleGiveawayStart(interaction);
            if (sub === 'end') return await handleGiveawayEnd(interaction);
            if (sub === 'reroll') return await handleGiveawayReroll(interaction);
            break;

          // Tickets
          case 'ticket-setup': 
            if (modules.tickets === false) return interaction.reply({ content: '❌ O módulo de **Tickets** está desativado.', ephemeral: true });
            return await handleTicketSetup(interaction);
        }
      }

      // --- BOTÕES ---
      if (interaction.isButton()) {
        switch (interaction.customId) {
          case 'giveaway_enter':
            if (modules.giveaway === false) return interaction.reply({ content: '❌ O módulo de Sorteios está desativado.', ephemeral: true });
            return await handleGiveawayButton(interaction);
          case 'ticket_open':
          case 'ticket_close':
          case 'ticket_transcript':
            if (modules.tickets === false) return interaction.reply({ content: '❌ O módulo de Tickets está desativado.', ephemeral: true });
            if (interaction.customId === 'ticket_open') return await handleTicketOpen(interaction);
            if (interaction.customId === 'ticket_close') return await handleTicketClose(interaction);
            if (interaction.customId === 'ticket_transcript') return await handleTicketTranscript(interaction);
        }

        // Reaction Roles via botões
        if (interaction.customId.startsWith('rr_')) {
          if (modules.reactionRoles === false) return interaction.reply({ content: '❌ O módulo de Reaction Roles está desativado.', ephemeral: true });
          return await handleReactionRoleButton(interaction);
        }
      }
    } catch (error) {
      console.error('[INTERACTION] Erro:', error);
      const reply = { content: '❌ Ocorreu um erro ao processar esta interação.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch (e) {
        // Ignorar erros de reply
      }
    }
  });
};

// Handler para Reaction Roles via botões
async function handleReactionRoleButton(interaction) {
  const config = getConfig();
  const reactionRoles = config.reactionRoles || [];

  const roleId = interaction.customId.replace('rr_', '');
  const member = interaction.member;

  const rrConfig = reactionRoles.find(rr =>
    rr.roles && rr.roles.some(r => r.roleId === roleId)
  );

  if (!rrConfig) {
    return interaction.reply({ content: '❌ Configuração de Reaction Role não encontrada.', ephemeral: true });
  }

  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ content: `✅ Cargo <@&${roleId}> **removido**!`, ephemeral: true });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ content: `✅ Cargo <@&${roleId}> **adicionado**!`, ephemeral: true });
    }
  } catch (err) {
    console.error('[RR] Erro ao alterar cargo:', err);
    await interaction.reply({ content: '❌ Não tenho permissão para gerir este cargo. Certifica-te de que o meu cargo está acima do cargo alvo na hierarquia.', ephemeral: true });
  }
}
