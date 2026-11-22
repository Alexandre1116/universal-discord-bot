const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const DisTube = require('distube');

let distube = null;
let musicInitError = null;
// Saídas iniciadas por nós: evita a mensagem duplicada de "desconectado"
const selfDisconnects = new Set();
// Temporizadores de "canal vazio" (dão margem a quem só troca de canal)
const emptyChannelTimers = new Map();
const EMPTY_CHANNEL_GRACE_MS = 30000;

function leaveVoice(guildId, queue) {
  // Cancela a saída agendada por "canal vazio": já estamos a sair
  const pendingEmpty = emptyChannelTimers.get(guildId);
  if (pendingEmpty) {
    clearTimeout(pendingEmpty);
    emptyChannelTimers.delete(guildId);
  }
  selfDisconnects.add(guildId);
  try {
    if (queue?.voice) queue.voice.leave();
    else if (distube) distube.voices.leave(guildId);
  } catch (err) {
    console.error('[MUSIC] Erro ao sair do canal de voz:', err.message);
  }
  // A flag não pode ficar para sempre se o evento disconnect não chegar
  setTimeout(() => selfDisconnects.delete(guildId), 5000).unref?.();
}

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

    // O DisTube v5 usa `ffmpeg` do PATH; o pacote ffmpeg-static traz o binário e
    // tem de ser passado explicitamente (fora do Docker, em Windows, não há ffmpeg no PATH).
    let ffmpegPath = null;
    try {
      ffmpegPath = require('ffmpeg-static');
    } catch (err) {
      console.warn('[MUSIC] ffmpeg-static indisponível, a usar o ffmpeg do PATH.');
    }

    distube = new DisTube.DisTube(client, {
      emitNewSongOnly: true,
      emitAddSongWhenCreatingQueue: false,
      emitAddListWhenCreatingQueue: false,
      savePreviousSongs: true,
      joinNewVoiceChannel: false,
      ...(ffmpegPath ? { ffmpeg: { path: ffmpegPath } } : {}),
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
      // No DisTube v5 o evento 'finish' é emitido mas o bot NÃO sai do canal, e
      // 'empty' deixou de ser emitido — por isso o leave é explícito.
      .on('finish', (queue) => {
        queue.textChannel?.send('🏁 Fila terminada. A sair do canal de voz.').catch(() => {});
        leaveVoice(queue.id, queue);
      })
      .on('disconnect', (queue) => {
        // Quando somos nós que desligamos (finish/stop/canal vazio) a outra
        // mensagem já foi dada — não repetimos
        if (queue && selfDisconnects.has(queue.id)) return;
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
    // Spotify/SoundCloud precisam de extratores adicionais do DisTube que não
    // vêm incluídos; anunciar apenas o que funciona evita promessas falsas.
    .setDescription('Toca música do YouTube (URL ou pesquisa por texto).')
    .addStringOption(o => o.setName('query').setDescription('URL do YouTube ou termo de pesquisa').setRequired(true)),

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
  // No v5 o DisTube não abandona o canal quando ficam todos os ouvintes fora;
  // sem isto o bot fica "pendurado" num canal de voz vazio.
  voiceStateUpdate: async (client, oldState, newState) => {
    if (!distube) return;
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const queue = distube.getQueue(guild.id);
    if (!queue) {
      const t = emptyChannelTimers.get(guild.id);
      if (t) {
        clearTimeout(t);
        emptyChannelTimers.delete(guild.id);
      }
      return;
    }

    const channel = guild.members.me?.voice?.channel;
    if (!channel) return;

    const humans = channel.members.filter(m => !m.user.bot);
    if (humans.size > 0) {
      // Alguém voltou (ou só trocou de canal): cancela a saída agendada
      const pending = emptyChannelTimers.get(guild.id);
      if (pending) {
        clearTimeout(pending);
        emptyChannelTimers.delete(guild.id);
      }
      return;
    }

    // Margem: evita desligar se o único ouvinte estiver apenas a trocar de canal
    if (emptyChannelTimers.has(guild.id)) return;
    const timer = setTimeout(() => {
      emptyChannelTimers.delete(guild.id);
      const q = distube.getQueue(guild.id);
      if (!q) return;
      const ch = guild.members.me?.voice?.channel;
      if (ch && ch.members.filter(m => !m.user.bot).size > 0) return;
      q.textChannel?.send('💤 Canal de voz vazio. A sair...').catch(() => {});
      leaveVoice(guild.id, q);
    }, EMPTY_CHANNEL_GRACE_MS);
    timer.unref?.();
    emptyChannelTimers.set(guild.id, timer);
  },

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
        // No DisTube 5.2.3 play() devolve Promise<void>: a confirmação é lida da
        // fila depois do await (o nome chega pelo evento playSong)
        await distube.play(voiceChannel, query, {
          member,
          textChannel: interaction.channel
        });
        const q = distube.getQueue(interaction.guild.id);
        const current = q?.songs?.[0];
        if (current) {
          await interaction.editReply(`🎶 ${String(current.name).slice(0, 100)} — ${q.songs.length > 1 ? `${q.songs.length} músicas na fila` : 'a tocar'}.`);
        } else {
          await interaction.editReply('🎶 Pedido aceite.');
        }
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
        try {
          await queue.pause();
          await interaction.reply('⏸️ Música pausada.');
        } catch (err) {
          await interaction.reply({ content: `❌ ${String(err.message).slice(0, 150)}`, ephemeral: true });
        }
        break;

      case 'resume':
        if (!queue.paused) return interaction.reply({ content: 'A música não está pausada.', ephemeral: true });
        try {
          await queue.resume();
          await interaction.reply('▶️ Música retomada.');
        } catch (err) {
          await interaction.reply({ content: `❌ ${String(err.message).slice(0, 150)}`, ephemeral: true });
        }
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
        try {
          if (queue) await queue.stop();
          // No DisTube v5 Queue.stop() apenas pára o áudio (voice.stop + remove)
          // e deixa a ligação: sem isto o bot fica preso no canal de voz
          leaveVoice(interaction.guild.id, queue || undefined);
          await interaction.reply('⏹️ Música parada, fila limpa e a sair do canal de voz.');
        } catch (err) {
          await interaction.reply({ content: `❌ ${String(err.message).slice(0, 150)}`, ephemeral: true });
        }
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
