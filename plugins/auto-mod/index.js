const { getConfig } = require('../../src/utils/config');
const { addWarning } = require('../../src/utils/database');

const spamTracker = new Map();
const SPAM_WINDOW = 5000;
const SPAM_THRESHOLD = 5;

function init(client) {
  console.log('[AUTO-MOD] Plugin inicializado.');
}

function isStaff(member) {
  return member.permissions.has('ManageMessages') || member.permissions.has('Administrator');
}

const events = {
  messageCreate: async (client, message) => {
    if (message.author.bot || !message.guild) return;

    const config = getConfig();
    const modConfig = config.moderation || {};
    if (modConfig.enabled === false) return;

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
      const urlPattern = /https?:\/\/[^\s]+/gi;
      const allowedChannels = modConfig.linkAllowedChannels || [];
      if (urlPattern.test(content) && !allowedChannels.includes(message.channel.id)) {
        violated = true;
        reason = 'Links não são permitidos neste canal';
      }
    }

    if (!violated && modConfig.bannedWords && modConfig.bannedWords.length > 0) {
      const lowerContent = content.toLowerCase();
      const found = modConfig.bannedWords.some(word => lowerContent.includes(word.toLowerCase()));
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

    if (violated) {
      try {
        await message.delete();

        addWarning(message.guild.id, message.author.id, client.user.id, reason);

        const maxStrikes = modConfig.maxStrikes || 3;
        const { getWarnings } = require('../../src/utils/database');
        const warnings = getWarnings(message.guild.id, message.author.id);

        if (warnings.length >= maxStrikes) {
          const action = modConfig.strikeAction || 'mute';
          if (action === 'kick') {
            await message.member.kick(reason);
          } else if (action === 'ban') {
            await message.member.ban({ reason });
          } else {
            let muteRole = message.guild.roles.cache.find(r => r.name === 'Muted');
            if (!muteRole) {
              muteRole = await message.guild.roles.create({ name: 'Muted', permissions: [] });
              message.guild.channels.cache.forEach(async (ch) => {
                if (ch.isTextBased()) {
                  await ch.permissionOverwrites.create(muteRole, { SendMessages: false });
                }
              });
            }
            await message.member.roles.add(muteRole);
          }
          await message.channel.send(`⚠️ <@${message.author.id}> foi punido por atingir o limite de avisos.`)
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        } else {
          await message.channel.send(`⚠️ <@${message.author.id}> ${reason}. Aviso ${warnings.length}/${maxStrikes}.`)
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
      } catch (err) {
        console.error('[AUTO-MOD] Erro ao processar moderacão:', err.message);
      }
    }
  }
};

module.exports = { init, events };
