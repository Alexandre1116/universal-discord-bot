const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const DisTube = require('distube');

let distube = null;

function init(client) {
  distube = new DisTube.DisTube(client, {
    emitNewSongOnly: true,
    leaveOnFinish: true,
    leaveOnStop: true,
    emitAddListWhenCreatingQueue: false
  });

  distube
    .on('playSong', (queue, song) => {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎵 A Tocar')
        .setDescription(`**[${song.name}](${song.url})**\nDuração: \`${song.formattedDuration}\`\nPedido por: ${song.member}`)
        .setThumbnail(song.thumbnail)
        .setTimestamp();
      queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
    })
    .on('addSong', (queue, song) => {
      queue.textChannel?.send(`✅ Adicionado à fila: **${song.name}** (\`${song.formattedDuration}\`)`).catch(() => {});
    })
    .on('playSongList', (queue, playlist) => {
      queue.textChannel?.send(`✅ Playlist adicionada: **${playlist.name}** com ${playlist.songs.length} músicas.`).catch(() => {});
    })
    .on('finish', (queue) => {
      queue.textChannel?.send('🏁 Fila terminada. A sair do canal de voz.').catch(() => {});
    })
    .on('empty', (queue) => {
      queue.textChannel?.send('💤 Ninguém no canal de voz. A sair...').catch(() => {});
    })
    .on('error', (channel, error) => {
      console.error('[MUSIC] Erro DisTube:', error.message);
      channel?.textChannel?.send(`❌ Erro: ${error.message.slice(0, 200)}`).catch(() => {});
    });

  console.log('[MUSIC] DisTube inicializado.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música de YouTube/Spotify/SoundCloud.')
    .addStringOption(o => o.setName('query').setDescription('URL ou termo de pesquisa').setRequired(true)),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa a música atual.'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Retoma a música pausada.'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Salta para a próxima música.'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Para a música e limpa a fila.'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Mostra a fila de músicas.'),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Mostra a música que está a tocar agora.'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta o volume (0-100).')
    .addIntegerOption(o => o.setName('volume').setDescription('Volume 0-100').setMinValue(0).setMaxValue(100).setRequired(true))
];

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const musicCommands = ['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'nowplaying', 'volume'];
    if (!musicCommands.includes(interaction.commandName)) return;

    if (!distube) {
      return interaction.reply({ content: 'O sistema de música ainda não está pronto.', ephemeral: true });
    }

    const { EmbedBuilder } = require('discord.js');
    const member = interaction.member;

    if (interaction.commandName === 'play') {
      if (!member.voice?.channel) {
        return interaction.reply({ content: 'Precisas de estar num canal de voz para usar este comando.', ephemeral: true });
      }

      const query = interaction.options.getString('query');
      try {
        await distube.play(member.voice.channel, query, {
          member,
          textChannel: interaction.channel
        });
        await interaction.reply({ content: `🔍 A procurar: \`${query}\`...`, ephemeral: true });
      } catch (err) {
        console.error('[MUSIC] Erro play:', err.message);
        await interaction.reply({ content: `Erro: ${err.message.slice(0, 200)}`, ephemeral: true });
      }
      return;
    }

    const queue = distube.getQueue(interaction.guild.id);
    if (!queue && interaction.commandName !== 'stop') {
      return interaction.reply({ content: 'Não há nada a tocar de momento.', ephemeral: true });
    }

    switch (interaction.commandName) {
      case 'pause':
        queue.pause();
        await interaction.reply('⏸️ Música pausada.');
        break;

      case 'resume':
        queue.resume();
        await interaction.reply('▶️ Música retomada.');
        break;

      case 'skip':
        try {
          await queue.skip();
          await interaction.reply('⏭️ Música saltada.');
        } catch {
          await interaction.reply({ content: 'Não há mais músicas na fila.', ephemeral: true });
        }
        break;

      case 'stop':
        if (queue) queue.stop();
        await interaction.reply('⏹️ Música parada e fila limpa.');
        break;

      case 'queue': {
        const songs = queue.songs.slice(0, 15);
        const list = songs.map((s, i) => `${i === 0 ? '▶️' : `${i}.`} **[${s.name}](${s.url})** — \`${s.formattedDuration}\``).join('\n');
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎶 Fila de Músicas')
          .setDescription(list || 'Fila vazia.')
          .setFooter({ text: `${queue.songs.length} música(s) na fila` })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'nowplaying': {
        const song = queue.songs[0];
        const embed = new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('🎵 A Tocar Agora')
          .setDescription(`**[${song.name}](${song.url})**`)
          .addFields(
            { name: 'Duração', value: `\`${song.formattedDuration}\``, inline: true },
            { name: 'Pedido por', value: song.member.toString(), inline: true }
          )
          .setThumbnail(song.thumbnail)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'volume': {
        const vol = interaction.options.getInteger('volume');
        queue.setVolume(vol);
        await interaction.reply(`🔊 Volume ajustado para ${vol}%`);
        break;
      }
    }
  }
};

module.exports = { init, commands, events };
