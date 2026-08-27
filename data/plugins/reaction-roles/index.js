const { getConfig } = require('../../utils/config');

function init(client) {
  console.log('[REACTION ROLES] Plugin inicializado.');
}

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isButton()) return;

    if (!interaction.customId.startsWith('rr_')) return;

    const roleId = interaction.customId.slice(3);
    const member = interaction.member;

    if (!member || !roleId) return;

    try {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) {
        return interaction.reply({ content: 'Cargo não encontrado.', ephemeral: true });
      }

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
        await interaction.reply({ content: `❌ Removeste o cargo <@&${roleId}>.`, ephemeral: true });
      } else {
        await member.roles.add(role);
        await interaction.reply({ content: `✅ Recebeste o cargo <@&${roleId}>.`, ephemeral: true });
      }
    } catch (err) {
      console.error('[REACTION ROLES] Erro ao processar botão:', err.message);
      await interaction.reply({ content: 'Erro ao processar o pedido. Verifica as permissões do bot.', ephemeral: true });
    }
  }
};

module.exports = { init, events };
