const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const DisTube = require('distube');

let distube = null;
let musicInitError = null;

function init(client) {
  try {
    // No DisTube v5 os extratores são plugins separados; sem eles o /play
    // não consegue resolver nada (YouTube, pesquisa por texto, etc.).
    const plugins = [];
    try {
      const { YouTubePlugin } = require('@distube/youtube');
      plugins.push(new YouTubePlugin());
      console.log('[MUSIC] Plugin de extração YouTube carregado.');
    } catch (err) {
      console.error('[MUSIC] @distube/youtube não está instalado — o /play não vai conseguir resolver músicas:', err.message);
    }

    distube = new DisTube.DisTube(client, {
      emitNewSongOnly: true,
      emitAddSongWhenCreatingQueue: false,
      emitAddListWhenCreatingQueue: false,
      savePreviousSongs: true,
      joinNewVoiceChannel: false,
      plugins
    });

    distube
      .on('playSong', (queue, song) => {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎵 A Tocar')
          .setDescription(`**[${song.name}](${song.url})**\nDuração: \`${song.formattedDuration}\`\nPedido por: ${song.member}`)
          .setThumbnail(song.thumbnail || null)
          .setTimestamp();
        queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
      })
      .on('addSong', (queue, song) => {
        queue.textChannel?.send(`✅ Adicionado à fila: **${song.name}** (\`${song.formattedDuration}\`)`).catch(() => {});
      })
      .on('addList', (queue, playlist) => {
        queue.textChannel?.send(`✅ Playlist adicionada: **${playlist.name}** com ${playlist.songs.length} músicas.`).catch(() => {});
      })
      .on('finish', (queue) => {
        queue.textChannel?.send('🏁 Fila terminada. A sair do canal de voz.').catch(() => {});
      })
      .on('empty', (queue) => {
        queue.textChannel?.send('💤 Ninguém no canal de voz. A sair...').catch(() => {});
      })
      .on('disconnect', (queue) => {
        queue.textChannel?.send('🔌 Desconectado do canal de voz. Fila limpa.').catch(() => {});
      })
      // Assinatura do DisTube v5: (error, queue, song)
      .on('error', (error, queue, song) => {
        console.error('[MUSIC] Erro DisTube:', error?.message);
        const channel = queue?.textChannel;
        channel?.send(`❌ Erro na música: ${String(error?.message || error).slice(0, 200)}`).catch(() => {});
      })
      .on('noRelated', (queue) => {
        queue.textChannel?.send('⚠️ Não consegui encontrar músicas relacionadas.').catch(() => {});
      });

    console.log('[MUSIC] DisTube inicializado.');
  } catch (err) {
    musicInitError = err.message;
    distube = null;
    console.error('[MUSIC] Falha ao inicializar o DisTube:', err.message);
  }
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

const MUSIC_COMMANDS = ['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'nowplaying', 'volume'];

const events = {
  interactionCreate: async (client, interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!MUSIC_COMMANDS.includes(interaction.commandName)) return;

    if (!distube) {
      return interaction.reply({
        content: `O sistema de música não está disponível${musicInitError ? `: ${musicInitError}`.slice(0, 180) : '. Tenta reiniciar o bot.'}`,
        ephemeral: true
      });
    }

    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'A música só funciona em servidores.', ephemeral: true });
    }

    const member = interaction.member;

    if (interaction.commandName === 'play') {
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: 'Precisas de estar num canal de voz para usar este comando.', ephemeral: true });
      }

      const me = interaction.guild.members.me;
      const permissions = voiceChannel.permissionsFor(me);
      if (!permissions?.has(['Connect', 'Speak'])) {
        return interaction.reply({ content: 'Não tenho permissão para falar nesse canal de voz.', ephemeral: true });
      }

      const query = interaction.options.getString('query');
      await interaction.deferReply();
      try {
        await distube.play(voiceChannel, query, {
          member,
          textChannel: interaction.channel
        });
        await interaction.editReply(`🔍 A procurar: \`${query.slice(0, 100)}\`...`);
      } catch (err) {
        console.error('[MUSIC] Erro play:', err.message);
        await interaction.editReply(`❌ Não consegui tocar isso: ${String(err.message).slice(0, 180)}`);
      }
      return;
    }

    const queue = distube.getQueue(interaction.guild.id);
    if (!queue && interaction.commandName !== 'stop') {
      return interaction.reply({ content: 'Não há nada a tocar de momento.', ephemeral: true });
    }

    switch (interaction.commandName) {
      case 'pause':
        if (queue.paused) return interaction.reply({ content: 'A música já está pausada.', ephemeral: true });
        queue.pause();
        await interaction.reply('⏸️ Música pausada.');
        break;

      case 'resume':
        if (!queue.paused) return interaction.reply({ content: 'A música não está pausada.', ephemeral: true });
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
        if (!song) return interaction.reply({ content: 'Não há nada a tocar de momento.', ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('🎵 A Tocar Agora')
          .setDescription(`**[${song.name}](${song.url})**`)
          .addFields(
            { name: 'Duração', value: `\`${song.formattedDuration}\``, inline: true },
            { name: 'Pedido por', value: `${song.member}`, inline: true }
          )
          .setThumbnail(song.thumbnail || null)
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
