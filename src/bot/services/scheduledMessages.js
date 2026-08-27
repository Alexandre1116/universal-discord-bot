const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getAllScheduledMessages, deleteScheduledMessage } = require('../../utils/database');

const activeJobs = new Map();

function startScheduledMessages(client) {
  refreshScheduledMessages(client);
  setInterval(() => refreshScheduledMessages(client), 60000);
  console.log('[SCHEDULER] Agendador de mensagens iniciado.');
}

function refreshScheduledMessages(client) {
  const messages = getAllScheduledMessages();

  const validIds = new Set(messages.map(m => m.id));

  for (const [id, job] of activeJobs) {
    if (!validIds.has(id)) {
      job.stop();
      activeJobs.delete(id);
    }
  }

  for (const msg of messages) {
    if (activeJobs.has(msg.id)) continue;

    if (msg.cron_expression) {
      if (!cron.validate(msg.cron_expression)) {
        console.warn(`[SCHEDULER] Expressão cron inválida para mensagem ${msg.id}: ${msg.cron_expression}`);
        continue;
      }

      const job = cron.schedule(msg.cron_expression, async () => {
        await executeScheduledMessage(client, msg);
      });

      activeJobs.set(msg.id, job);
    } else if (msg.one_shot_at) {
      const targetTime = new Date(msg.one_shot_at).getTime();
      const delay = targetTime - Date.now();

      if (delay > 0) {
        const timer = setTimeout(async () => {
          await executeScheduledMessage(client, msg);
          deleteScheduledMessage(msg.id);
          activeJobs.delete(msg.id);
        }, delay);

        activeJobs.set(msg.id, { stop: () => clearTimeout(timer) });
      } else {
        deleteScheduledMessage(msg.id);
      }
    }
  }
}

async function executeScheduledMessage(client, msg) {
  try {
    const channel = client.channels.cache.get(msg.channel_id) ||
      await client.channels.fetch(msg.channel_id).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      console.warn(`[SCHEDULER] Canal não encontrado para mensagem ${msg.id}`);
      return;
    }

    const payload = {};

    if (msg.content) {
      payload.content = msg.content;
    }

    if (msg.embed_json) {
      try {
        const embedData = JSON.parse(msg.embed_json);
        const embed = new EmbedBuilder(embedData);
        payload.embeds = [embed];
      } catch (e) {
        console.warn(`[SCHEDULER] Embed JSON inválido para mensagem ${msg.id}:`, e.message);
      }
    }

    if (!payload.content && !payload.embeds) {
      payload.content = 'Mensagem agendada (sem conteúdo definido).';
    }

    await channel.send(payload);
    console.log(`[SCHEDULER] Mensagem ${msg.id} enviada para o canal ${msg.channel_id}`);
  } catch (err) {
    console.error(`[SCHEDULER] Erro ao enviar mensagem ${msg.id}:`, err);
  }
}

module.exports = { startScheduledMessages, refreshScheduledMessages };
