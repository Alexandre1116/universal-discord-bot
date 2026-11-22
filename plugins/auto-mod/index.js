const { getConfig } = require('../../src/utils/config');
const { addWarning, getWarnings } = require('../../src/utils/database');

const spamTracker = new Map();
const SPAM_WINDOW = 5000;
const SPAM_THRESHOLD = 5;

function init(client) {
  console.log('[AUTO-MOD] Plugin inicializado.');
}

function isStaff(member) {
  if (!member || !member.permissions) return false;
  return member.permissions.has('Administrator')
    || member.permissions.has('ManageMessages')
    || member.permissions.has('ModerateMembers');
}

// Aceita durações legíveis ('10m', '1h') e milissegundos; máx. 28 dias
function parseDuration(value, fallbackMs = 24 * 60 * 60 * 1000) {
  if (typeof value === 'number' && value > 0) return Math.min(value, 28 * 24 * 60 * 60 * 1000);
  if (typeof value === 'string' && value.trim()) {
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const match = value.trim().toLowerCase().match(/^(\d+)\s*([smhd])?$/);
    if (match) {
      const amount = parseInt(match[1], 10);
      const mult = units[match[2] || 'm'] || 60000;
      return Math.min(amount * mult, 28 * 24 * 60 * 60 * 1000);
    }
  }
  return fallbackMs;
}

async function applyStrikeAction(member, modConfig, reason) {
  const action = modConfig.strikeAction || 'mute';

  if (action === 'kick') {
    if (member.kickable) await member.kick(reason);
    return 'expulso';
  }

  if (action === 'ban') {
    if (member.bannable) await member.ban({ reason });
    return 'banido';
  }

  // mute: usar timeout nativo sempre que possível
  if (member.moderatable) {
    await member.timeout(parseDuration(modConfig.muteDuration), reason);
    return 'silenciado';
  }

  // fallback: cargo "Muted" com overwrites no canal
  const muteRole = member.guild.roles.cache.find(r => r.name === 'Muted');
  if (muteRole && !member.roles.cache.has(muteRole.id)) {
    await member.roles.add(muteRole);
    return 'silenciado (cargo Muted)';
  }

  return 'punido (sem permissão para aplicar a ação)';
}

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild || !message.content) return;

    const config = getConfig();
    const modConfig = config.moderation || {};
    if (!modConfig.enabled) return;

    const member = message.member;
    if (!member || isStaff(member)) return;

    const content = message.content;
    let violated = false;
    let reason = '';

    if (modConfig.antiSpam) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const timestamps = spamTracker.get(key) || [];
      const recent = timestamps.filter(t => now - t < SPAM_WINDOW);
      recent.push(now);
      spamTracker.set(key, recent);

      if (recent.length > SPAM_THRESHOLD) {
        violated = true;
        reason = 'Spam detectado (mensagens rápidas demais)';
        spamTracker.delete(key);
      }
    }

    if (!violated && modConfig.antiLinks) {
      const urlPattern = /https?:\/\/[^\s]+|discord\.(gg|me)\/[^\s]+/gi;
      const allowedChannels = modConfig.linkAllowedChannels || [];
      if (urlPattern.test(content) && !allowedChannels.includes(message.channel.id)) {
        violated = true;
        reason = 'Links não são permitidos neste canal';
      }
    }

    if (!violated && modConfig.bannedWords && modConfig.bannedWords.length > 0) {
      const lowerContent = content.toLowerCase();
      const found = modConfig.bannedWords.some(word => word && lowerContent.includes(word.toLowerCase()));
      if (found) {
        violated = true;
        reason = 'Uso de palavras proibidas';
      }
    }

    if (!violated && modConfig.antiCaps) {
      const letters = content.replace(/[^a-zA-Zà-úÀ-Ú]/g, '');
      if (letters.length > 10) {
        const upperCount = letters.replace(/[^A-ZÀ-Ú]/g, '').length;
        if (upperCount / letters.length > 0.7) {
          violated = true;
          reason = 'Uso excessivo de maiúsculas';
        }
      }
    }

    if (!violated) return;

    try {
      try {
        await message.delete();
      } catch (deleteErr) {
        console.warn('[AUTO-MOD] Sem permissão para apagar a mensagem:', deleteErr.message);
      }

      addWarning(message.guild.id, message.author.id, client.user.id, reason);
      const maxStrikes = modConfig.maxStrikes || 3;
      const warnings = getWarnings(message.guild.id, message.author.id);

      if (warnings.length >= maxStrikes) {
        const outcome = await applyStrikeAction(member, modConfig, reason);
        await message.channel.send({ content: `⚠️ <@${message.author.id}> foi **${outcome}** por atingir o limite de avisos (${warnings.length}/${maxStrikes}).` })
          .then(m => setTimeout(() => m.delete().catch(() => {}), 5000))
          .catch(() => {});
      } else {
        await message.channel.send({ content: `⚠️ <@${message.author.id}> ${reason}. Aviso ${warnings.length}/${maxStrikes}.` })
          .then(m => setTimeout(() => m.delete().catch(() => {}), 5000))
          .catch(() => {});
      }
    } catch (err) {
      console.error('[AUTO-MOD] Erro ao processar moderação:', err.message);
    }
  }
};

module.exports = { init, events };
