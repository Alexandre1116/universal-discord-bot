const { EmbedBuilder } = require('discord.js');
const { getUserXp, getLeaderboard, xpForLevel } = require('../../utils/database');

async function handleRank(interaction) {
  const user = interaction.options.getUser('utilizador') || interaction.user;
  const data = getUserXp(interaction.guildId, user.id);

  const currentLevelXp = xpForLevel(data.level);
  const nextLevelXp = xpForLevel(data.level + 1);
  const progress = nextLevelXp > currentLevelXp
    ? Math.round(((data.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100)
    : 100;

  // Barra de progresso visual
  const barFilled = Math.round(progress / 5);
  const barEmpty = 20 - barFilled;
  const progressBar = '█'.repeat(barFilled) + '░'.repeat(barEmpty);

  const embed = new EmbedBuilder()
    .setTitle(`📈 Rank de ${user.username}`)
    .setColor('#5865F2')
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
    .addFields(
      { name: '⭐ Nível', value: `**${data.level}**`, inline: true },
      { name: '✨ XP Total', value: `**${data.xp}**`, inline: true },
      { name: '💬 Mensagens', value: `**${data.total_messages}**`, inline: true },
      { name: `📊 Progresso para Nível ${data.level + 1}`, value: `\`${progressBar}\` ${progress}%\n${data.xp} / ${Math.round(nextLevelXp)} XP` }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
  const leaderboard = getLeaderboard(interaction.guildId, 10);

  if (leaderboard.length === 0) {
    return interaction.reply({ content: '📭 Ainda ninguém tem XP neste servidor! Comecem a conversar!', ephemeral: true });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = leaderboard.map((entry, i) => {
    const prefix = i < 3 ? medals[i] : `**#${i + 1}**`;
    return `${prefix} <@${entry.user_id}> — Nível **${entry.level}** (${entry.xp} XP)`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🏆 Leaderboard de Níveis')
    .setDescription(lines.join('\n'))
    .setColor('#FFD700')
    .setFooter({ text: `Servidor: ${interaction.guild.name}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

module.exports = { handleRank, handleLeaderboard };
