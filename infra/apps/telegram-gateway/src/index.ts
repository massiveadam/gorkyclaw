/**
 * Telegram Gateway
 * Receives Telegram messages, interfaces with NanoClaw, manages approvals
 */

import { Telegraf, Markup, Context } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { type Job, type Plan, type JobStatus } from './types.js';
import { JobsDatabase } from './db.js';
import { PolicyEngine } from './policy.js';
import { ObsidianLogger } from './obsidian.js';
import { NanoClawClient } from './nanoclaw-client.js';

// Environment configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_USER_IDS =
  process.env.TELEGRAM_ALLOWED_USER_IDS?.split(',').map(Number) || [];
const OPS_RUNNER_URL = process.env.OPS_RUNNER_URL || 'http://ops-runner:8080';
const OPS_RUNNER_SECRET = process.env.OPS_RUNNER_SHARED_SECRET!;
const NANOCALW_URL = process.env.NANOCALW_URL || 'http://nanoclaw:3000/plan';
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH!;

if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN required');
if (!OPS_RUNNER_SECRET) throw new Error('OPS_RUNNER_SHARED_SECRET required');
if (!OBSIDIAN_VAULT_PATH) throw new Error('OBSIDIAN_VAULT_PATH required');

// Initialize services
const db = new JobsDatabase();
const policy = new PolicyEngine();
const obsidian = new ObsidianLogger(OBSIDIAN_VAULT_PATH);
const nanoclaw = new NanoClawClient(NANOCALW_URL);
const bot = new Telegraf(BOT_TOKEN);

// Track pending approvals in memory (jobId -> {chatId, messageId})
const pendingApprovals = new Map<
  string,
  { chatId: number; messageId: number }
>();

// ============================================================================
// Middleware
// ============================================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(userId)) {
    console.log(`Unauthorized access attempt by user ${userId}`);
    await ctx.reply('⛔ You are not authorized to use this bot.');
    return;
  }

  return next();
});

// ============================================================================
// Message Handler
// ============================================================================

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const user = ctx.from;
  const chatId = ctx.chat.id;

  console.log(
    `[${new Date().toISOString()}] Message from ${user.username || user.first_name}: ${text}`,
  );

  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');

    // Get plan from NanoClaw
    const planResult = await nanoclaw.getPlan(text, {
      userId: user.id,
      username: user.username,
      chatId,
    });

    if (planResult.error) {
      await ctx.reply(`❌ Error: ${planResult.error}`);
      return;
    }

    if (!planResult.plan) {
      await ctx.reply('❌ No plan received from NanoClaw');
      return;
    }

    const plan = planResult.plan;
    const requiresApproval = plan.actions.some((a) => a.requiresApproval);

    // Create job
    const job: Job = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      status: requiresApproval ? 'proposed' : 'approved',
      requestedBy: {
        telegramUserId: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      plan,
      requiresApproval,
    };

    if (!requiresApproval) {
      job.approvedAt = new Date().toISOString();
      job.approvedBy = user.id;
    }

    db.createJob(job);

    // Build summary message
    const summary = buildPlanSummary(job, plan);

    if (requiresApproval) {
      // Send with approval buttons
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `approve:${job.id}`),
        Markup.button.callback('❌ Deny', `deny:${job.id}`),
      ]);

      const msg = await ctx.reply(summary, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      pendingApprovals.set(job.id, { chatId, messageId: msg.message_id });
    } else {
      // Auto-execute safe actions
      await ctx.reply(
        summary + '\n\n⚡ *Executing immediately (safe diagnostics)*',
        { parse_mode: 'Markdown' },
      );
      await executeJob(job, ctx);
    }
  } catch (error) {
    console.error('Error processing message:', error);
    await ctx.reply(
      `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
});

// ============================================================================
// Approval Callback Handlers
// ============================================================================

bot.action(/approve:(.+)/, async (ctx) => {
  const jobId = ctx.match[1];
  const user = ctx.from;

  try {
    const job = db.getJob(jobId);
    if (!job) {
      await ctx.answerCbQuery('Job not found');
      return;
    }

    if (job.status !== 'proposed') {
      await ctx.answerCbQuery(`Job already ${job.status}`);
      return;
    }

    // Update job
    db.updateJobStatus(jobId, 'approved', {
      approvedAt: new Date().toISOString(),
      approvedBy: user.id,
    });

    await ctx.answerCbQuery('Approved!');

    // Edit message to show approval
    await ctx.editMessageText(
      buildPlanSummary(job, job.plan) +
        `\n\n✅ *Approved by ${user.first_name}*`,
      { parse_mode: 'Markdown' },
    );

    pendingApprovals.delete(jobId);

    // Execute job
    await executeJob({ ...job, status: 'approved', approvedBy: user.id }, ctx);
  } catch (error) {
    console.error('Error approving job:', error);
    await ctx.answerCbQuery('Error approving job');
  }
});

bot.action(/deny:(.+)/, async (ctx) => {
  const jobId = ctx.match[1];
  const user = ctx.from;

  try {
    const job = db.getJob(jobId);
    if (!job) {
      await ctx.answerCbQuery('Job not found');
      return;
    }

    if (job.status !== 'proposed') {
      await ctx.answerCbQuery(`Job already ${job.status}`);
      return;
    }

    db.updateJobStatus(jobId, 'denied', {
      deniedAt: new Date().toISOString(),
      deniedReason: `Denied by ${user.first_name}`,
    });

    await ctx.answerCbQuery('Denied');

    await ctx.editMessageText(
      buildPlanSummary(job, job.plan) + `\n\n❌ *Denied by ${user.first_name}*`,
      { parse_mode: 'Markdown' },
    );

    pendingApprovals.delete(jobId);
  } catch (error) {
    console.error('Error denying job:', error);
    await ctx.answerCbQuery('Error denying job');
  }
});

// ============================================================================
// Job Execution
// ============================================================================

async function executeJob(job: Job, ctx: Context): Promise<void> {
  try {
    db.updateJobStatus(job.id, 'executing');

    const response = await fetch(`${OPS_RUNNER_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        sharedSecret: OPS_RUNNER_SECRET,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ops runner returned ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      db.updateJobStatus(job.id, 'executed', {
        executedAt: new Date().toISOString(),
        results: result.results,
      });

      // Log to Obsidian
      const notesPath = await obsidian.logJob({
        ...job,
        status: 'executed',
        executedAt: new Date().toISOString(),
        results: result.results,
      });

      db.updateJobStatus(job.id, 'executed', { notesPath });

      // Send results
      await sendResults(ctx, job, result.results);
    } else {
      throw new Error(result.error || 'Execution failed');
    }
  } catch (error) {
    console.error('Error executing job:', error);
    db.updateJobStatus(job.id, 'failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await ctx.reply(
      `❌ *Execution failed*\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
      { parse_mode: 'Markdown' },
    );
  }
}

async function sendResults(
  ctx: Context,
  job: Job,
  results: Array<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<void> {
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const action = job.plan.actions[i];
    const actionLabel = getActionLabel(action);

    let message = `**Action ${i + 1}/${results.length}:** ${actionLabel}\n\n`;

    if (result.exitCode === 0) {
      message += `✅ *Success*\n\n`;
    } else {
      message += `⚠️ *Exit code: ${result.exitCode}*\n\n`;
    }

    if (result.stdout) {
      const stdout = result.stdout.slice(0, 3000);
      message += `**Output:**\n\`\`\`\n${stdout}\n\`\`\``;
    }

    if (result.stderr) {
      const stderr = result.stderr.slice(0, 1000);
      message += `\n\n**Stderr:**\n\`\`\`\n${stderr}\n\`\`\``;
    }

    // Split if too long
    if (message.length > 4000) {
      const chunks = message.match(/.{1,4000}/g) || [message];
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      }
    } else {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildPlanSummary(job: Job, plan: Plan): string {
  let summary = `**📋 Plan: ${plan.summary}**\n\n`;

  plan.actions.forEach((action, i) => {
    const icon = action.requiresApproval ? '🔒' : '⚡';
    summary += `${icon} **${i + 1}.** ${getActionLabel(action)}\n`;
    summary += `   _${action.reason}_\n\n`;
  });

  return summary;
}

function getActionLabel(action: Plan['actions'][number]): string {
  switch (action.type) {
    case 'ssh':
      return `${action.command} on \`${action.target}\``;
    case 'web_fetch':
      return `${action.mode} fetch ${action.url}`;
    case 'obsidian_write':
      return `write note ${action.path}`;
    case 'notify':
      return `notify: ${action.message}`;
    default:
      return 'action';
  }
}

// ============================================================================
// Commands
// ============================================================================

bot.command('start', async (ctx) => {
  await ctx.reply(
    '🤖 *OpenClaw Gateway*\n\n' +
      "Send me natural language commands and I'll:\n" +
      '1. Plan the actions needed\n' +
      '2. Check safety policies\n' +
      '3. Ask for approval (if needed)\n' +
      '4. Execute and log results\n\n' +
      '*Examples:*\n' +
      '• Check uptime on william\n' +
      '• Show disk usage on willy-ubuntu\n' +
      '• List docker containers',
    { parse_mode: 'Markdown' },
  );
});

bot.command('jobs', async (ctx) => {
  const jobs = db.getRecentJobs(10);

  if (jobs.length === 0) {
    await ctx.reply('No jobs found');
    return;
  }

  let message = '**Recent Jobs:**\n\n';
  jobs.forEach((job) => {
    const statusEmoji = {
      proposed: '⏳',
      approved: '✅',
      denied: '❌',
      executing: '🔄',
      executed: '✅',
      failed: '💥',
      cancelled: '🚫',
    }[job.status];

    message += `${statusEmoji} \`${job.id.slice(0, 8)}\` ${job.plan.summary.slice(0, 40)}\n`;
  });

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============================================================================
// Start Bot
// ============================================================================

console.log('🚀 Starting Telegram Gateway...');
console.log(
  `   Allowed users: ${ALLOWED_USER_IDS.length > 0 ? ALLOWED_USER_IDS.join(', ') : 'All'}`,
);
console.log(`   Ops Runner: ${OPS_RUNNER_URL}`);
console.log(`   Obsidian: ${OBSIDIAN_VAULT_PATH}`);

bot.launch();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop('SIGINT');
  db.close();
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  db.close();
});
