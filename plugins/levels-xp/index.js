const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../../src/utils/config');
const { addXp, addVoiceXp, getUserXp, getLeaderboard, canGainXp, calculateLevel, xpForLevel } = require('../../src/utils/database');

// Voice XP: Map<guildId, Map<userId, NodeJS.Timeout>>
const voiceTimers = new Map();

function init(client) {
  console.log('[LEVELS XP] Plugin inicializado.');

  // Quem já estava em canal de voz quando o bot ligou também ganha XP
  // (o cache dos servidores ainda pode estar a ser preenchido, daí o atraso).
  // A reconciliação repete-se para apanhar quem entra em voz enquanto a
  // definição esteve desligada e volta a ser ligada.
  const reconcile = () => {
    try {
      reconcileVoiceSessions(client, getConfig().levels || {});
    } catch (err) {
      console.error('[LEVELS XP] Erro ao retomar sessões de voz:', err.message);
    }
  };
  setTimeout(reconcile, 15000);
  setInterval(reconcile, 2 * 60 * 1000);
}

const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o teu rank, nível e XP atual.'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Mostra o top 10 de membros com mais XP.')
];

// A Web UI grava { type: 'level' | 'xp', requirement, roleId }; versões antigas
// gravavam { level, roleId }. O plugin aceita os dois formatos.
function matchRoleRewards(levelsConfig, result) {
  const rewards = levelsConfig.roles || [];
  return rewards.filter(r => {
    if (!r || !r.roleId) return false;
    const requirement = (r.requirement !== undefined ? r.requirement : r.level);
    if (requirement === undefined || requirement === null || isNaN(requirement)) return false;
    if ((r.type || 'level') === 'xp') return result.xp >= Number(requirement);
    return result.level >= Number(requirement);
  });
}

async function grantRoleRewards(guild, memberId, levelsConfig, result) {
  const rewards = matchRoleRewards(levelsConfig, result);
  if (rewards.length === 0) return;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return;

  for (const reward of rewards) {
    try {
      const role = guild.roles.cache.get(reward.roleId) || await guild.roles.fetch(reward.roleId).catch(() => null);
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role, `Recompensa de nível/XP (${result.level})`);
      }
    } catch (err) {
      console.error('[LEVELS XP] Erro ao atribuir cargo de nível:', err.message);
    }
  }
}

async function announceLevelUp(client, guild, userId, result, levelsConfig, fromVoice, fallbackChannel) {
  const announceChannelId = levelsConfig.announceChannelId;
  // Sem canal de anúncios configurado, anunciar no canal onde o XP foi ganho
  // (a UI apresenta o campo como opcional; antes não dizia nada sem ele)
  const channel = announceChannelId
    ? (guild.channels.cache.get(announceChannelId) || await guild.channels.fetch(announceChannelId).catch(() => null))
    : (fallbackChannel && fallbackChannel.isTextBased() ? fallbackChannel : null);
  if (!channel || !channel.isTextBased()) return;

  try {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎉 Subiste de Nível!')
      .setDescription(`<@${userId}> subiu para o nível **${result.level}**!${fromVoice ? ' (XP de voz)' : ''}`)
      .setTimestamp();

    const user = client.users.cache.get(userId);
    if (user) embed.setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }));

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[LEVELS XP] Erro ao enviar mensagem de level up:', err.message);
  }
}

async function awardXp(client, guild, userId, amount, levelsConfig, fromVoice = false, fallbackChannel = null) {
  // O XP de voz não conta como mensagem nem consome o cooldown do XP por mensagem
  const result = fromVoice ? addVoiceXp(guild.id, userId, amount) : addXp(guild.id, userId, amount);

  // As recompensas (por nível ou por XP) são avaliadas em TODOS os ganhos: um
  // limiar de XP pode ser cruzado sem que aconteça uma subida de nível.
  const levels = getConfig().levels || levelsConfig;
  await grantRoleRewards(guild, userId, levels, result);

  if (result.leveledUp) {
    await announceLevelUp(client, guild, userId, result, levels, fromVoice, fallbackChannel);
  }

  return result;
}

// ---------- VOICE XP ----------
function stopVoiceTimer(guildId, userId) {
  const guildTimers = voiceTimers.get(guildId);
  if (!guildTimers) return;
  const timer = guildTimers.get(userId);
  if (timer) clearInterval(timer);
  guildTimers.delete(userId);
  if (guildTimers.size === 0) voiceTimers.delete(guildId);
}

function startVoiceTimer(client, guild, userId, levelsConfig) {
  const intervalSeconds = Math.max(10, parseInt(levelsConfig.voiceXpInterval, 10) || 60);

  if (!voiceTimers.has(guild.id)) voiceTimers.set(guild.id, new Map());
  const guildTimers = voiceTimers.get(guild.id);
  if (guildTimers.has(userId)) return;

  const timer = setInterval(async () => {
    try {
      // Re-lê a configuração em cada tick: desligar o XP de voz (ou os níveis)
      // tem de parar imediatamente quem já está em canal de voz
      const levels = getConfig().levels || {};
      if (!levels.enabled || levels.voiceXpEnabled === false) {
        stopVoiceTimer(guild.id, userId);
        return;
      }

      const channel = guild.members.cache.get(userId)?.voice?.channel;
      if (!channel) {
        stopVoiceTimer(guild.id, userId);
        return;
      }

      const amount = Math.max(1, parseInt(levels.voiceXpAmount, 10) || 5);
      await awardXp(client, guild, userId, amount, levels, true);
    } catch (err) {
      console.error('[LEVELS XP] Erro ao dar XP de voz:', err.message);
    }
  }, intervalSeconds * 1000);

  guildTimers.set(userId, timer);
}

// Quem já estava em canal de voz quando o bot ligou também ganha XP
function stopAllVoiceTimers() {
  for (const [guildId, timers] of voiceTimers.entries()) {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    voiceTimers.delete(guildId);
  }
}

// Re-liga timers para quem já está em voz (no arranque e sempre que a
// configuração volta a ser ativada)
function reconcileVoiceSessions(client, levelsConfig) {
  if (!levelsConfig.enabled || levelsConfig.voiceXpEnabled === false) {
    stopAllVoiceTimers();
    return;
  }
  const inVoice = new Map();
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      // VoiceState usa .id (o user_id); 'memberId' não existe no discord.js v14
      const memberId = state.id;
      if (!memberId || state.channelId == null) continue;
      if (!state.member || state.member.user.bot) continue;
      if (!inVoice.has(guild.id)) inVoice.set(guild.id, new Set());
      inVoice.get(guild.id).add(memberId);
      startVoiceTimer(client, guild, memberId, levelsConfig);
    }
  }

  // Pára timers de quem já não está em voz (o voiceStateUpdate pode ter-se perdido)
  for (const [guildId, timers] of voiceTimers.entries()) {
    if (!client.guilds.cache.has(guildId)) continue;
    const present = inVoice.get(guildId) || new Set();
    for (const [memberId, timer] of [...timers.entries()]) {
      if (present.has(memberId)) continue;
      clearInterval(timer);
      timers.delete(memberId);
    }
  }
}

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const levelsConfig = config.levels || {};
    if (!levelsConfig.enabled) return;

    const cooldown = levelsConfig.xpCooldown || 60;
    if (!canGainXp(message.guild.id, message.author.id, cooldown)) return;

    const minXp = levelsConfig.minXp || 15;
    const maxXp = levelsConfig.maxXp || 25;
    const xpGain = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;

    await awardXp(client, message.guild, message.author.id, xpGain, levelsConfig, false, message.channel);
  },

  voiceStateUpdate: async (client, oldState, newState) => {
    const config = getConfig();
    const levelsConfig = config.levels || {};
    if (!levelsConfig.enabled || levelsConfig.voiceXpEnabled === false) return;

    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const userId = (newState.member || oldState.member)?.id;
    if (!userId) return;
    if ((newState.member || oldState.member)?.user?.bot) return;

    const left = newState.channelId === null || newState.channelId === undefined;
    const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if (left && !switched) {
      stopVoiceTimer(guild.id, userId);
      return;
    }

    if (newState.channelId) startVoiceTimer(client, guild, userId, levelsConfig);
  },

  guildDelete: (client, guild) => {
    // Cancela os intervalos um a um: apagar só o Map deixava timers a correr
    // para sempre com o servidor em closure
    const timers = voiceTimers.get(guild.id);
    if (timers) {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    }
    voiceTimers.delete(guild.id);
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
