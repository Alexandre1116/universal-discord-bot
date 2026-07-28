const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  commands: [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Toca uma música')
      .addStringOption(option => 
        option.setName('query')
          .setDescription('O nome ou link da música')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Avança para a próxima música'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Para a música e limpa a fila'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Mostra a fila de reprodução'),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Altera o volume')
      .addIntegerOption(option => 
        option.setName('percent')
          .setDescription('Volume de 1 a 100')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
  ],

  async execute(interaction, client) {
    const { commandName } = interaction;
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Precisas de estar num canal de voz!', ephemeral: true });
    }

    if (commandName === 'play') {
      const query = interaction.options.getString('query');
      await interaction.deferReply();
      try {
        await client.distube.play(voiceChannel, query, {
          member: interaction.member,
          textChannel: interaction.channel,
          interaction
        });
        await interaction.editReply(`🔎 A procurar e adicionar: \`${query}\``);
      } catch (e) {
        await interaction.editReply(`❌ Erro: ${e.message}`);
      }
    } 
    else if (commandName === 'skip') {
      const queue = client.distube.getQueue(interaction);
      if (!queue) return interaction.reply({ content: '❌ Não há nenhuma música a tocar.', ephemeral: true });
      try {
        if (queue.songs.length === 1 && !queue.autoplay) {
          queue.stop();
          return interaction.reply('⏹️ Não há mais músicas. Parei a reprodução.');
        }
        await queue.skip();
        interaction.reply('⏭️ Música avançada!');
      } catch (e) {
        interaction.reply(`❌ Erro: ${e.message}`);
      }
    }
    else if (commandName === 'stop') {
      const queue = client.distube.getQueue(interaction);
      if (!queue) return interaction.reply({ content: '❌ Não há nenhuma música a tocar.', ephemeral: true });
      queue.stop();
      interaction.reply('⏹️ Música parada e fila limpa.');
    }
    else if (commandName === 'queue') {
      const queue = client.distube.getQueue(interaction);
      if (!queue) return interaction.reply({ content: '❌ A fila está vazia.', ephemeral: true });
      const q = queue.songs
        .map((song, i) => `${i === 0 ? 'Tocar:' : `${i}.`} ${song.name} - \`${song.formattedDuration}\``)
        .join('\n');
      interaction.reply({ content: `**Fila Atual**\n${q.substring(0, 1900)}` });
    }
    else if (commandName === 'volume') {
      const queue = client.distube.getQueue(interaction);
      if (!queue) return interaction.reply({ content: '❌ Não há nenhuma música a tocar.', ephemeral: true });
      const vol = interaction.options.getInteger('percent');
      queue.setVolume(vol);
      interaction.reply(`🔊 Volume alterado para ${vol}%`);
    }
  }
};
