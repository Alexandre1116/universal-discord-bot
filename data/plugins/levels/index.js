const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');

// Caminhos absolutos para módulos do Core
const databasePath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'database');
const configPath = path.join(__dirname, '..', '..', '..', 'src', 'utils', 'config');

const { getUserXp, getLeaderboard, xpForLevel, addXp, canGainXp } = require(databasePath);
const { getConfig } = require(configPath);

const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o teu nível e XP no servidor.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro (ou tu próprio se vazio)')),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Mostra o ranking de XP/Níveis do servidor.')
];

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

async function handleXpGain(message, levelsConfig) {
  // Verificar cooldown (1 minuto por padrão)
  const cooldown = levelsConfig.xpCooldown || 60;
  if (!canGainXp(message.guild.id, message.author.id, cooldown)) return;

  // XP aleatório entre 15-25 por padrão
  const minXp = levelsConfig.minXp || 15;
  const maxXp = levelsConfig.maxXp || 25;
  const xpAmount = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;

  const result = addXp(message.guild.id, message.author.id, xpAmount);

  const announceChannel = levelsConfig.announceChannelId
    ? (message.guild.channels.cache.get(levelsConfig.announceChannelId) || message.channel)
    : message.channel;

  // Anúncio de level up
  if (result.leveledUp) {
    try {
      await announceChannel.send({ content: `🎉 Parabéns ${message.author}! Subiste para o **Nível ${result.level}**! 🌟` });
    } catch (err) {
      console.error('[XP] Erro ao anunciar level up:', err.message);
    }
  }

  // Verificar e atribuir recompensas (cargos)
  const levelRoles = levelsConfig.roles || [];
  if (levelRoles.length > 0 && message.member) {
    for (const reward of levelRoles) {
      const type = reward.type || 'level'; 
      const requirement = reward.requirement || reward.level; 
      const roleId = reward.roleId;

      if (!roleId) continue;

      let meetsRequirement = false;
      if (type === 'level' && result.level >= requirement) {
        meetsRequirement = true;
      } else if (type === 'xp' && result.xp >= requirement) {
        meetsRequirement = true;
      }

      if (meetsRequirement && !message.member.roles.cache.has(roleId)) {
        try {
          const role = message.guild.roles.cache.get(roleId);
          if (role) {
            await message.member.roles.add(role);
            const reqText = type === 'level' ? `atingir o Nível ${requirement}` : `acumular ${requirement} XP`;
            await announceChannel.send({ content: `🎭 ${message.author} recebeu o cargo **${role.name}** por ${reqText}!` });
          }
        } catch (err) {
          console.error('[XP] Erro ao atribuir recompensa:', err.message);
        }
      }
    }
  }
}

async function handleVoiceXpReward(client, member, joinTime, guildId) {
  if (!joinTime) return;
  const config = getConfig();
  const levelsConfig = config.levels || {};
  if (!levelsConfig.enabled) return;

  const diffMs = Date.now() - joinTime;
  const minutes = Math.floor(diffMs / 60000);
  
  if (minutes > 0) {
    const xpPerMin = levelsConfig.voiceXpPerMin || 5;
    const totalXp = minutes * xpPerMin;
    const result = addXp(guildId, member.id, totalXp);

    if (result.leveledUp) {
      const announceChannel = levelsConfig.announceChannelId
        ? (client.channels.cache.get(levelsConfig.announceChannelId))
        : null;
      if (announceChannel) {
        try {
          await announceChannel.send({ content: `🎉 Parabéns ${member}! Subiste para o **Nível ${result.level}** (Ganho via Canal de Voz)! 🌟` });
        } catch (e) {}
      }
    }
  }
}

const voiceTracker = new Map();

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'rank': await handleRank(interaction); break;
      case 'leaderboard': await handleLeaderboard(interaction); break;
    }
  },
  
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;
    const config = getConfig();
    const levelsConfig = config.levels || {};
    if (levelsConfig.enabled) {
      await handleXpGain(message, levelsConfig);
    }
  },

  voiceStateUpdate: async (client, oldState, newState) => {
    const memberId = newState.id;
    // Condições de mute ou ausência de canal: parar de contar XP
    if (!newState.channelId || newState.mute || newState.deaf || newState.selfMute || newState.selfDeaf) {
      if (voiceTracker.has(memberId)) {
        const joinTime = voiceTracker.get(memberId);
        voiceTracker.delete(memberId);
        await handleVoiceXpReward(client, newState.member, joinTime, newState.guild.id);
      }
    } else {
      // Entrou num canal e não está mutado
      if (!voiceTracker.has(memberId) && newState.channelId) {
        voiceTracker.set(memberId, Date.now());
      }
    }
  }
};

module.exports = {
  commands,
  events
};
