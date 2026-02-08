/**
 * IPC-based MCP Server for NanoClaw (Claude Agent SDK Edition)
 * Provides tool implementations that write messages and tasks to files for the host process to pick up
 */

import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

export interface IpcMcpContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

async function handleSendMessage(args: { text: string }): Promise<CallToolResult> {
  const data = {
    type: 'message',
    chatJid: process.env.NANOCLAW_CHAT_JID || 'unknown',
    text: args.text,
    groupFolder: process.env.NANOCLAW_GROUP_FOLDER || 'main',
    timestamp: new Date().toISOString(),
  };

  const filename = writeIpcFile(MESSAGES_DIR, data);
  return textResult(`Message queued for delivery (${filename})`);
}

async function handleScheduleTask(
  args: {
    prompt: string;
    schedule_type: 'cron' | 'interval' | 'once';
    schedule_value: string;
    context_mode?: 'group' | 'isolated';
    target_group?: string;
  },
  ctx: IpcMcpContext,
): Promise<CallToolResult> {
  if (args.schedule_type === 'cron') {
    try {
      CronExpressionParser.parse(args.schedule_value);
    } catch {
      return textResult(
        `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).`,
        true,
      );
    }
  } else if (args.schedule_type === 'interval') {
    const ms = parseInt(args.schedule_value, 10);
    if (isNaN(ms) || ms <= 0) {
      return textResult(
        `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).`,
        true,
      );
    }
  } else if (args.schedule_type === 'once') {
    const date = new Date(args.schedule_value);
    if (isNaN(date.getTime())) {
      return textResult(
        `Invalid timestamp: "${args.schedule_value}". Use ISO 8601 format like "2026-02-01T15:30:00.000Z".`,
        true,
      );
    }
  }

  const targetGroup = ctx.isMain && args.target_group ? args.target_group : ctx.groupFolder;

  const data = {
    type: 'schedule_task',
    prompt: args.prompt,
    schedule_type: args.schedule_type,
    schedule_value: args.schedule_value,
    context_mode: args.context_mode || 'group',
    groupFolder: targetGroup,
    chatJid: ctx.chatJid,
    createdBy: ctx.groupFolder,
    timestamp: new Date().toISOString(),
  };

  const filename = writeIpcFile(TASKS_DIR, data);
  return textResult(`Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}`);
}

async function handleListTasks(ctx: { groupFolder: string; isMain: boolean }): Promise<CallToolResult> {
  const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

  try {
    if (!fs.existsSync(tasksFile)) {
      return textResult('No scheduled tasks found.');
    }

    const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8')) as Array<{ groupFolder?: string }>;

    const tasks = ctx.isMain
      ? allTasks
      : allTasks.filter((task) => task.groupFolder === ctx.groupFolder);

    if (tasks.length === 0) {
      return textResult('No scheduled tasks found.');
    }

    return textResult(JSON.stringify(tasks, null, 2));
  } catch (err) {
    return textResult(
      `Failed to read tasks: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}

async function handleTaskAction(
  action: 'pause' | 'resume' | 'cancel',
  args: { task_id: string },
  ctx: IpcMcpContext,
): Promise<CallToolResult> {
  const data = {
    type: `${action}_task`,
    task_id: args.task_id,
    groupFolder: ctx.groupFolder,
    chatJid: ctx.chatJid,
    requestedBy: ctx.groupFolder,
    timestamp: new Date().toISOString(),
  };

  const filename = writeIpcFile(TASKS_DIR, data);
  return textResult(`Task ${action} requested (${filename}): ${args.task_id}`);
}

async function handleRegisterGroup(
  args: { jid: string; name: string; folder: string; trigger: string },
  ctx: { isMain: boolean },
): Promise<CallToolResult> {
  if (!ctx.isMain) {
    return textResult('Only the main group can register new groups.', true);
  }

  const data = {
    type: 'register_group',
    jid: args.jid,
    name: args.name,
    folder: args.folder,
    trigger: args.trigger,
    timestamp: new Date().toISOString(),
  };

  const filename = writeIpcFile(TASKS_DIR, data);
  return textResult(`Group registration requested (${filename}): ${args.name}`);
}

export function createIpcMcpServer(
  ctx: IpcMcpContext,
): McpSdkServerConfigWithInstance {
  const sendMessageTool = tool(
    'send_message',
    'Send a message back to the user',
    { text: z.string() },
    async (args) => handleSendMessage(args),
  );

  const scheduleTaskTool = tool(
    'schedule_task',
    'Schedule a new task',
    {
      prompt: z.string(),
      schedule_type: z.enum(['cron', 'interval', 'once']),
      schedule_value: z.string(),
      context_mode: z.enum(['group', 'isolated']).optional(),
      target_group: z.string().optional(),
    },
    async (args) => handleScheduleTask(args, ctx),
  );

  const listTasksTool = tool(
    'list_tasks',
    'List scheduled tasks',
    {},
    async () => handleListTasks({ groupFolder: ctx.groupFolder, isMain: ctx.isMain }),
  );

  const pauseTaskTool = tool(
    'pause_task',
    'Pause a scheduled task',
    { task_id: z.string() },
    async (args) => handleTaskAction('pause', args, ctx),
  );

  const resumeTaskTool = tool(
    'resume_task',
    'Resume a scheduled task',
    { task_id: z.string() },
    async (args) => handleTaskAction('resume', args, ctx),
  );

  const cancelTaskTool = tool(
    'cancel_task',
    'Cancel a scheduled task',
    { task_id: z.string() },
    async (args) => handleTaskAction('cancel', args, ctx),
  );

  const registerGroupTool = tool(
    'register_group',
    'Register a new group (main group only)',
    {
      jid: z.string(),
      name: z.string(),
      folder: z.string(),
      trigger: z.string(),
    },
    async (args) => handleRegisterGroup(args, { isMain: ctx.isMain }),
  );

  return createSdkMcpServer({
    name: 'nanoclaw',
    version: '1.0.0',
    tools: [
      sendMessageTool,
      scheduleTaskTool,
      listTasksTool,
      pauseTaskTool,
      resumeTaskTool,
      cancelTaskTool,
      registerGroupTool,
    ],
  });
}
