const path = require('path');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');
const { getConfig } = require(configPath);

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isButton()) return;
    
    // Reaction Roles via botões
    if (interaction.customId.startsWith('rr_')) {
      await handleReactionRoleButton(interaction);
    }
  }
};

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

module.exports = {
  events
};
