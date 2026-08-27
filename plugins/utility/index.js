const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const commands = [
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
    .addStringOption(o => o.setName('opcao5').setDescription('Quinta opção'))
];

async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  await guild.members.fetch();

  const rolesCount = guild.roles.cache.size;
  const emojisCount = guild.emojis.cache.size;
  const textChannels = guild.channels.cache.filter(c => c.isTextBased()).size;
  const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased()).size;
  const onlineMembers = guild.members.cache.filter(m => m.presence?.status === 'online' || m.presence?.status === 'idle' || m.presence?.status === 'dnd').size;

  const embed = new EmbedBuilder()
    .setTitle(`📊 Informações do Servidor`)
    .setColor('#5865F2')
    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: '📛 Nome', value: guild.name, inline: true },
      { name: '👑 Dono', value: `<@${guild.ownerId}>`, inline: true },
      { name: '📅 Criado em', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: '👥 Membros', value: `${guild.memberCount} total | ~${onlineMembers} online`, inline: true },
      { name: '💬 Canais de Texto', value: `${textChannels}`, inline: true },
      { name: '🔊 Canais de Voz', value: `${voiceChannels}`, inline: true },
      { name: '🎭 Cargos', value: `${rolesCount}`, inline: true },
      { name: '😀 Emojis', value: `${emojisCount}`, inline: true },
      { name: '🔒 Nível de Verificação', value: guild.verificationLevel.toString(), inline: true },
      { name: '🆔 Server ID', value: guild.id, inline: false }
    )
    .setTimestamp();

  if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 512 }));

  await interaction.reply({ embeds: [embed] });
}

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('utilizador') || interaction.user;
  const member = interaction.guild.members.cache.get(user.id) ||
    await interaction.guild.members.fetch(user.id).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(`👤 Informações de ${user.tag}`)
    .setColor('#5865F2')
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: '📛 Nome', value: user.tag, inline: true },
      { name: '🆔 ID', value: user.id, inline: true },
      { name: '🤖 Bot?', value: user.bot ? 'Sim' : 'Não', inline: true },
      { name: '📅 Conta Criada', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  if (member) {
    embed.addFields(
      { name: '📥 Entrou no Servidor', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
      { name: '🎨 Cor', value: member.displayHexColor || 'Default', inline: true },
      { name: '🎭 Cargos', value: member.roles.cache.filter(r => r.id !== interaction.guildId).map(r => `<@&${r.id}>`).join(', ') || 'Nenhum', inline: false }
    );
    if (member.nickname) embed.addFields({ name: '📝 Nickname', value: member.nickname, inline: true });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleAvatar(interaction) {
  const user = interaction.options.getUser('utilizador') || interaction.user;

  const embed = new EmbedBuilder()
    .setTitle(`🖼️ Avatar de ${user.tag}`)
    .setColor('#5865F2')
    .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
    .addFields(
      { name: '🔗 Links', value: [
        `[PNG](${user.displayAvatarURL({ extension: 'png', size: 1024 })})`,
        `[JPG](${user.displayAvatarURL({ extension: 'jpg', size: 1024 })})`,
        `[WEBP](${user.displayAvatarURL({ extension: 'webp', size: 1024 })})`
      ].join(' | ') }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handlePoll(interaction) {
  const question = interaction.options.getString('pergunta');
  const options = [];
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

  for (let i = 1; i <= 5; i++) {
    const opt = interaction.options.getString(`opcao${i}`);
    if (opt) options.push(opt);
  }

  const description = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${question}`)
    .setDescription(description)
    .setColor('#5865F2')
    .setFooter({ text: `Votação criada por ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  const msg = await interaction.fetchReply();

  for (let i = 0; i < options.length; i++) {
    await msg.react(emojis[i]);
  }
}

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'serverinfo': await handleServerInfo(interaction); break;
      case 'userinfo': await handleUserInfo(interaction); break;
      case 'avatar': await handleAvatar(interaction); break;
      case 'poll': await handlePoll(interaction); break;
    }
  }
};

module.exports = {
  commands,
  events
};
