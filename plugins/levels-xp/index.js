const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');
const { addXp, getUserXp, getLeaderboard, canGainXp, calculateLevel, xpForLevel } = require('../../src/utils/database');

function init(client) {
  console.log('[LEVELS XP] Plugin inicializado.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o teu rank, nível e XP atual.'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Mostra o top 10 de membros com mais XP.')
];

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const levelsConfig = config.levels || {};
    if (levelsConfig.enabled === false) return;

    const cooldown = levelsConfig.xpCooldown || 60;
    if (!canGainXp(message.guild.id, message.author.id, cooldown)) return;

    const minXp = levelsConfig.minXp || 15;
    const maxXp = levelsConfig.maxXp || 25;
    const xpGain = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;

    const result = addXp(message.guild.id, message.author.id, xpGain);

    if (result.leveledUp) {
      const announceChannelId = levelsConfig.announceChannelId;
      if (announceChannelId) {
        const channel = message.guild.channels.cache.get(announceChannelId);
        if (channel) {
          try {
            const embed = new EmbedBuilder()
              .setColor('#5865F2')
              .setTitle('🎉 Subiste de Nível!')
              .setDescription(`<@${message.author.id}> subiu para o nível **${result.level}**!`)
              .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 256 }))
              .setTimestamp();
            await channel.send({ embeds: [embed] });
          } catch (err) {
            console.error('[LEVELS XP] Erro ao enviar mensagem de level up:', err.message);
          }
        }
      }

      const levelRoles = levelsConfig.roles || [];
      const roleForLevel = levelRoles.find(r => r.level === result.level);
      if (roleForLevel) {
        try {
          const member = await message.guild.members.fetch(message.author.id).catch(() => null);
          if (member) {
            const role = message.guild.roles.cache.get(roleForLevel.roleId);
            if (role && !member.roles.cache.has(role.id)) {
              await member.roles.add(role);
            }
          }
        } catch (err) {
          console.error('[LEVELS XP] Erro ao atribuir cargo de nível:', err.message);
        }
      }
    }
  },

  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rank') {
      const data = getUserXp(interaction.guild.id, interaction.user.id);
      const level = data.level || 0;
      const currentXp = data.xp || 0;
      const xpNeeded = Math.floor(xpForLevel(level + 1));
      const xpForCurrent = Math.floor(xpForLevel(level));
      const progress = currentXp - xpForCurrent;
      const progressMax = xpNeeded - xpForCurrent;

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
        .setTitle('📊 Cartão de Rank')
        .addFields(
          { name: 'Nível', value: `${level}`, inline: true },
          { name: 'XP', value: `${progress}/${progressMax || 1}`, inline: true },
          { name: 'XP Total', value: `${currentXp}`, inline: true },
          { name: 'Mensagens', value: `${data.total_messages || 0}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply();

      const leaderboard = getLeaderboard(interaction.guild.id, 10);

      if (leaderboard.length === 0) {
        return interaction.editReply({ content: 'Ainda não há dados suficientes para o leaderboard.' });
      }

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Leaderboard de XP')
        .setTimestamp();

      const medals = ['🥇', '🥈', '🥉'];
      const description = leaderboard.map((entry, i) => {
        const medal = medals[i] || `**${i + 1}.**`;
        return `${medal} <@${entry.user_id}> — Nível ${entry.level} (${entry.xp} XP)`;
      }).join('\n');

      embed.setDescription(description);

      await interaction.editReply({ embeds: [embed] });
    }
  }
};

module.exports = { init, commands, events };
