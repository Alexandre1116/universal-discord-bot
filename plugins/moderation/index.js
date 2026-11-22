const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const ms = require('ms');
const path = require('path');

// Caminho absoluto para a base de dados central
const databasePath = path.join(__dirname, '..', '..', 'src', 'utils', 'database');
const configPath = path.join(__dirname, '..', '..', 'src', 'utils', 'config');

const { addWarning, getWarnings, clearWarnings, parseDbDate } = require(databasePath);
const { getConfig } = require(configPath);

// Comandos
const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um utilizador do servidor.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro a banir').setRequired(true))
    .addStringOption(o => o.setName('razão').setDescription('Motivo do ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa um utilizador do servidor.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro a expulsar').setRequired(true))
    .addStringOption(o => o.setName('razão').setDescription('Motivo da expulsão'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Silencia (timeout) um utilizador.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro a silenciar').setRequired(true))
    .addStringOption(o => o.setName('duração').setDescription('Duração (ex: 10m, 1h, 1d)').setRequired(true))
    .addStringOption(o => o.setName('razão').setDescription('Motivo do silêncio'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove o silêncio (timeout) de um utilizador.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Dá um aviso a um utilizador.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro a avisar').setRequired(true))
    .addStringOption(o => o.setName('razão').setDescription('Motivo do aviso'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Mostra os avisos de um utilizador.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Limpa todos os avisos de um utilizador.')
    .addUserOption(o => o.setName('utilizador').setDescription('O membro').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga mensagens recentes do canal.')
    .addIntegerOption(o => o.setName('quantidade').setDescription('Mensagens a apagar (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
];

// Funções de Handling
async function sendAuditLog(guild, embed) {
  try {
    const config = getConfig();
    const auditConfig = config.auditLog || {};
    if (!auditConfig.enabled || !auditConfig.channelId) return;

    const channel = guild.channels.cache.get(auditConfig.channelId) ||
      await guild.channels.fetch(auditConfig.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[AUDIT] Erro ao enviar log:', err.message);
  }
}

async function handleBan(interaction) {
  const target = interaction.options.getMember('utilizador');
  const reason = interaction.options.getString('razão') || 'Sem razão especificada';

  if (!target) return interaction.reply({ content: '❌ Utilizador não encontrado no servidor.', ephemeral: true });
  if (!target.bannable) return interaction.reply({ content: '❌ Não tenho permissão para banir este utilizador.', ephemeral: true });

  await target.ban({ reason: `${reason} | Banido por ${interaction.user.tag}` });

  const embed = new EmbedBuilder()
    .setTitle('🔨 Utilizador Banido')
    .setColor('#ED4245')
    .addFields(
      { name: 'Utilizador', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderador', value: interaction.user.tag, inline: true },
      { name: 'Razão', value: reason }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  await sendAuditLog(interaction.guild, embed);
}

async function handleKick(interaction) {
  const target = interaction.options.getMember('utilizador');
  const reason = interaction.options.getString('razão') || 'Sem razão especificada';

  if (!target) return interaction.reply({ content: '❌ Utilizador não encontrado no servidor.', ephemeral: true });
  if (!target.kickable) return interaction.reply({ content: '❌ Não tenho permissão para expulsar este utilizador.', ephemeral: true });

  await target.kick(`${reason} | Expulso por ${interaction.user.tag}`);

  const embed = new EmbedBuilder()
    .setTitle('👢 Utilizador Expulso')
    .setColor('#FFA500')
    .addFields(
      { name: 'Utilizador', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderador', value: interaction.user.tag, inline: true },
      { name: 'Razão', value: reason }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  await sendAuditLog(interaction.guild, embed);
}

async function handleMute(interaction) {
  const target = interaction.options.getMember('utilizador');
  const durationStr = interaction.options.getString('duração');
  const reason = interaction.options.getString('razão') || 'Sem razão especificada';

  if (!target) return interaction.reply({ content: '❌ Utilizador não encontrado no servidor.', ephemeral: true });
  if (!target.moderatable) return interaction.reply({ content: '❌ Não tenho permissão para silenciar este utilizador.', ephemeral: true });

  const duration = ms(durationStr);
  if (!duration || duration < 1000 || duration > 28 * 24 * 60 * 60 * 1000) {
    return interaction.reply({ content: '❌ Duração inválida. Usa formatos como: 10m, 1h, 1d (máximo: 28d).', ephemeral: true });
  }

  await target.timeout(duration, `${reason} | Silenciado por ${interaction.user.tag}`);

  const embed = new EmbedBuilder()
    .setTitle('🔇 Utilizador Silenciado')
    .setColor('#FEE75C')
    .addFields(
      { name: 'Utilizador', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderador', value: interaction.user.tag, inline: true },
      { name: 'Duração', value: durationStr, inline: true },
      { name: 'Razão', value: reason }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  await sendAuditLog(interaction.guild, embed);
}

async function handleUnmute(interaction) {
  const target = interaction.options.getMember('utilizador');
  if (!target) return interaction.reply({ content: '❌ Utilizador não encontrado no servidor.', ephemeral: true });

  await target.timeout(null);
  await interaction.reply({ content: `✅ O silêncio de **${target.user.tag}** foi removido.`, ephemeral: false });
}

async function handleWarn(interaction) {
  const target = interaction.options.getMember('utilizador');
  const reason = interaction.options.getString('razão') || 'Sem razão especificada';

  if (!target) return interaction.reply({ content: '❌ Utilizador não encontrado no servidor.', ephemeral: true });

  addWarning(interaction.guildId, target.id, interaction.user.id, reason);
  const totalWarnings = getWarnings(interaction.guildId, target.id);

  const config = getConfig();
  const modConfig = config.moderation || {};
  const maxStrikes = modConfig.maxStrikes || 3;
  const strikeAction = modConfig.strikeAction || 'mute';

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Aviso Emitido')
    .setColor('#FEE75C')
    .addFields(
      { name: 'Utilizador', value: `${target.user.tag} (${target.id})`, inline: true },
      { name: 'Moderador', value: interaction.user.tag, inline: true },
      { name: 'Razão', value: reason },
      { name: 'Total de Avisos', value: `${totalWarnings.length} / ${maxStrikes}`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  await sendAuditLog(interaction.guild, embed);

  if (totalWarnings.length >= maxStrikes) {
    try {
      if (strikeAction === 'mute' && target.moderatable) {
        await target.timeout(24 * 60 * 60 * 1000, `Auto-mute: ${maxStrikes} avisos atingidos`);
        await interaction.followUp({ content: `🔇 **${target.user.tag}** foi automaticamente silenciado por 24h (${maxStrikes} avisos).` });
      } else if (strikeAction === 'kick' && target.kickable) {
        await target.kick(`Auto-kick: ${maxStrikes} avisos atingidos`);
        await interaction.followUp({ content: `👢 **${target.user.tag}** foi automaticamente expulso (${maxStrikes} avisos).` });
      } else if (strikeAction === 'ban' && target.bannable) {
        await target.ban({ reason: `Auto-ban: ${maxStrikes} avisos atingidos` });
        await interaction.followUp({ content: `🔨 **${target.user.tag}** foi automaticamente banido (${maxStrikes} avisos).` });
      }
    } catch (err) {
      console.error('[MOD] Erro ao aplicar auto-ação de strikes:', err);
    }
  }
}

async function handleWarnings(interaction) {
  const target = interaction.options.getUser('utilizador');
  const warnings = getWarnings(interaction.guildId, target.id);

  if (warnings.length === 0) {
    return interaction.reply({ content: `✅ **${target.tag}** não tem avisos registados.`, ephemeral: true });
  }

  const list = warnings.slice(0, 10).map((w, i) => {
    const when = parseDbDate(w.created_at);
    // sem timestamp quando a data for ilegível: o parse antigo colava 'Z' a tudo
    // e podia produzir <t:NaN:R> (o Discord mostrava a linha partida)
    return `**#${i + 1}** — ${w.reason}${when ? `\n<t:${Math.floor(when.getTime() / 1000)}:R>` : ''}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(`📋 Avisos de ${target.tag}`)
    .setDescription(list)
    .setColor('#5865F2')
    .setFooter({ text: `Total: ${warnings.length} avisos` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleClearWarnings(interaction) {
  const target = interaction.options.getUser('utilizador');
  clearWarnings(interaction.guildId, target.id);
  await interaction.reply({ content: `✅ Todos os avisos de **${target.tag}** foram limpos.` });
}

async function handleClear(interaction) {
  const amount = interaction.options.getInteger('quantidade');

  if (!interaction.channel || typeof interaction.channel.bulkDelete !== 'function') {
    return interaction.reply({ content: '❌ Este canal não permite apagar mensagens em massa.', ephemeral: true });
  }

  try {
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await interaction.reply({ content: `🧹 ${deleted.size} mensagem(ns) apagada(s).`, ephemeral: true });

    if (deleted.size > 0) {
      const embed = new EmbedBuilder()
        .setTitle('🧹 Mensagens Apagadas')
        .setColor('#FFA500')
        .addFields(
          { name: 'Moderador', value: interaction.user.tag, inline: true },
          { name: 'Canal', value: `#${interaction.channel.name}`, inline: true },
          { name: 'Quantidade', value: `${deleted.size} (pedido: ${amount})` }
        )
        .setTimestamp();
      await sendAuditLog(interaction.guild, embed);
    }
  } catch (err) {
    await interaction.reply({ content: `❌ Erro ao apagar mensagens: ${err.message}`, ephemeral: true });
  }
}

// Eventos
// NOTA: a auto-moderação (anti-spam, anti-links, caps, palavras proibidas)
// pertence ao plugin "auto-mod". Não é duplicada aqui de propósito, senão as
// mensagens seriam apagadas/punidas duas vezes.
const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    switch (interaction.commandName) {
      case 'ban': await handleBan(interaction); break;
      case 'kick': await handleKick(interaction); break;
      case 'mute': await handleMute(interaction); break;
      case 'unmute': await handleUnmute(interaction); break;
      case 'warn': await handleWarn(interaction); break;
      case 'warnings': await handleWarnings(interaction); break;
      case 'clearwarnings': await handleClearWarnings(interaction); break;
      case 'clear': await handleClear(interaction); break;
    }
  }
};

module.exports = {
  commands,
  events
};
