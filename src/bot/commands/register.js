const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const musicCommands = require('./music').commands;
function getCommandDefinitions() {
  return [
    // --- MODERAÇÃO ---
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

    // --- UTILIDADE ---
    new SlashCommandBuilder()
      .setName('serverinfo')
      .setDescription('Mostra informações detalhadas sobre o servidor.'),

    new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Mostra informações sobre um utilizador.')
      .addUserOption(o => o.setName('utilizador').setDescription('O membro (ou tu próprio se vazio)')),

    new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Mostra o avatar de um utilizador.')
      .addUserOption(o => o.setName('utilizador').setDescription('O membro (ou tu próprio se vazio)')),

    new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Cria uma votação rápida.')
      .addStringOption(o => o.setName('pergunta').setDescription('A pergunta da votação').setRequired(true))
      .addStringOption(o => o.setName('opcao1').setDescription('Primeira opção').setRequired(true))
      .addStringOption(o => o.setName('opcao2').setDescription('Segunda opção').setRequired(true))
      .addStringOption(o => o.setName('opcao3').setDescription('Terceira opção'))
      .addStringOption(o => o.setName('opcao4').setDescription('Quarta opção'))
      .addStringOption(o => o.setName('opcao5').setDescription('Quinta opção')),

    // --- NÍVEIS ---
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Mostra o teu nível e XP no servidor.')
      .addUserOption(o => o.setName('utilizador').setDescription('O membro (ou tu próprio se vazio)')),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Mostra o ranking de XP/Níveis do servidor.'),

    // --- GIVEAWAY ---
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Gere sorteios no servidor.')
      .addSubcommand(sub =>
        sub.setName('start')
          .setDescription('Inicia um novo sorteio.')
          .addStringOption(o => o.setName('premio').setDescription('O que será sorteado').setRequired(true))
          .addStringOption(o => o.setName('duração').setDescription('Duração (ex: 1h, 1d, 7d)').setRequired(true))
          .addIntegerOption(o => o.setName('vencedores').setDescription('Número de vencedores (padrão: 1)').setMinValue(1).setMaxValue(20))
          .addChannelOption(o => o.setName('canal').setDescription('Canal onde publicar (padrão: canal atual)'))
      )
      .addSubcommand(sub =>
        sub.setName('end')
          .setDescription('Termina um sorteio antecipadamente.')
          .addStringOption(o => o.setName('mensagem_id').setDescription('ID da mensagem do sorteio').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('reroll')
          .setDescription('Sorteia novos vencedores para um sorteio terminado.')
          .addStringOption(o => o.setName('mensagem_id').setDescription('ID da mensagem do sorteio').setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    // --- TICKETS ---
    new SlashCommandBuilder()
      .setName('ticket-setup')
      .setDescription('Cria o painel de tickets com um botão para abrir ticket.')
      .addChannelOption(o => o.setName('canal').setDescription('Canal para o painel de tickets'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ];
}

async function registerCommands(clientId, token) {
  if (!clientId || !token) {
    console.warn('[COMMANDS] CLIENT_ID ou TOKEN não configurados. Slash commands não registados.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = getCommandDefinitions().map(c => c.toJSON());
  
  // Adicionar os comandos de música
  for (const mc of musicCommands) {
    commands.push(mc.toJSON());
  }

  try {
    console.log(`[COMMANDS] A registar ${commands.length} slash commands globalmente...`);
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log(`[COMMANDS] ${commands.length} slash commands registados com sucesso!`);
  } catch (error) {
    console.error('[COMMANDS] Erro ao registar slash commands:', error);
  }
}

module.exports = { registerCommands, getCommandDefinitions };
