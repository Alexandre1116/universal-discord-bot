const { getConfig } = require('../../utils/config');
const { addXp, canGainXp } = require('../../utils/database');
const { recordMessageStat } = require('../../utils/database');

// Anti-spam tracker em memória
const spamTracker = new Map();
const SPAM_WINDOW = 5000; // 5 segundos
const SPAM_THRESHOLD = 5; // 5 mensagens em 5 segundos

module.exports = function registerMessageCreate(client) {
  client.on('messageCreate', async (message) => {
    // Ignorar bots e DMs
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const modules = config.modules || {};

    // --- CUSTOM COMMANDS ---
    if (modules.customCommands !== false) {
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
            return; // Para a execução (evita auto-moderação nisto se necessário, ou permite)
          } catch (e) {
            console.error('[CUSTOM COMMANDS] Erro ao enviar resposta:', e.message);
          }
        }
      }
    }

    // --- AUTO-MODERAÇÃO ---
    if (modules.moderation !== false) {
      const modConfig = config.moderation || {};
      if (modConfig.enabled) {
        const deleted = await handleAutoMod(message, modConfig);
        if (deleted) return; // Mensagem foi eliminada, não processar mais
      }
    }

    // --- ESTATÍSTICAS ---
    try {
      recordMessageStat(message.guild.id, message.channel.id, message.author.id);
    } catch (err) {
      // Silenciar erros de stats para não afetar o bot
    }

    // --- SISTEMA DE XP ---
    if (modules.levels !== false) {
      const levelsConfig = config.levels || {};
      if (levelsConfig.enabled) {
        await handleXpGain(message, levelsConfig);
      }
    }
  });
};

async function handleAutoMod(message, modConfig) {
  const content = message.content.toLowerCase();
  const member = message.member;

  // Ignorar membros com permissão de gestão
  if (member && member.permissions.has('ManageMessages')) return false;

  // 1. Filtro de palavras proibidas
  if (modConfig.bannedWords && modConfig.bannedWords.length > 0) {
    const banned = modConfig.bannedWords.some(word => content.includes(word.toLowerCase()));
    if (banned) {
      try {
        await message.delete();
        await message.channel.send({ content: `⚠️ ${message.author}, a tua mensagem continha palavras proibidas e foi removida.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        console.log(`[AUTOMOD] Palavra proibida detetada de ${message.author.tag}`);
        return true;
      } catch (err) {
        console.error('[AUTOMOD] Erro ao apagar mensagem:', err.message);
      }
    }
  }

  // 2. Anti-links
  if (modConfig.antiLinks) {
    const linkRegex = /(https?:\/\/[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (linkRegex.test(message.content)) {
      // Verificar se o canal é permitido para links
      const allowedChannels = modConfig.linkAllowedChannels || [];
      if (!allowedChannels.includes(message.channel.id)) {
        try {
          await message.delete();
          await message.channel.send({ content: `⚠️ ${message.author}, links não são permitidos neste canal.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
          return true;
        } catch (err) {
          console.error('[AUTOMOD] Erro anti-links:', err.message);
        }
      }
    }
  }

  // 3. Anti-spam
  if (modConfig.antiSpam) {
    const userId = message.author.id;
    const now = Date.now();

    if (!spamTracker.has(userId)) {
      spamTracker.set(userId, []);
    }

    const timestamps = spamTracker.get(userId);
    timestamps.push(now);

    // Limpar mensagens antigas
    const recent = timestamps.filter(t => now - t < SPAM_WINDOW);
    spamTracker.set(userId, recent);

    if (recent.length >= SPAM_THRESHOLD) {
      try {
        await message.delete();
        // Timeout de 60 segundos
        if (member && member.moderatable) {
          await member.timeout(60 * 1000, 'Anti-spam: mensagens a velocidade excessiva');
        }
        await message.channel.send({ content: `⚠️ ${message.author}, foste temporariamente silenciado por spam.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        spamTracker.delete(userId);
        return true;
      } catch (err) {
        console.error('[AUTOMOD] Erro anti-spam:', err.message);
      }
    }
  }

  // 4. Anti-caps excessivo
  if (modConfig.antiCaps && message.content.length > 10) {
    const upperCount = (message.content.match(/[A-Z]/g) || []).length;
    const ratio = upperCount / message.content.length;
    if (ratio > 0.7) {
      try {
        await message.delete();
        await message.channel.send({ content: `⚠️ ${message.author}, evita usar caps lock excessivo.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        return true;
      } catch (err) {
        console.error('[AUTOMOD] Erro anti-caps:', err.message);
      }
    }
  }

  return false;
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
      const type = reward.type || 'level'; // default fallback for older configs
      const requirement = reward.requirement || reward.level; // fallback
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
