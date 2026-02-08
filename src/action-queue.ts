import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import type { Plan } from './plan-contract.js';

export interface ActionProposalRecord {
  id: string;
  createdAt: string;
  status: 'proposed' | 'approved' | 'denied';
  groupFolder: string;
  chatJid: string;
  requestText?: string;
  actions: Plan['actions'];
  decidedAt?: string;
  decisionReason?: string;
}

const ACTION_QUEUE_PATH = path.join(DATA_DIR, 'action-queue.json');

function createId(): string {
  return `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueActionProposal(input: {
  groupFolder: string;
  chatJid: string;
  plan: Plan;
  requestText?: string;
}): ActionProposalRecord | null {
  if (!Array.isArray(input.plan.actions) || input.plan.actions.length === 0) {
    return null;
  }

  const record: ActionProposalRecord = {
    id: createId(),
    createdAt: new Date().toISOString(),
    status: 'proposed',
    groupFolder: input.groupFolder,
    chatJid: input.chatJid,
    requestText: input.requestText?.trim() || undefined,
    actions: input.plan.actions,
  };

  const queue = readActionQueue();
  queue.push(record);
  writeActionQueue(queue);

  return record;
}

export function readActionQueue(): ActionProposalRecord[] {
  try {
    if (!fs.existsSync(ACTION_QUEUE_PATH)) return [];
    const raw = fs.readFileSync(ACTION_QUEUE_PATH, 'utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ActionProposalRecord[];
  } catch {
    return [];
  }
}

function writeActionQueue(queue: ActionProposalRecord[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACTION_QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
}

export function getPendingActionProposals(chatJid: string): ActionProposalRecord[] {
  return readActionQueue()
    .filter((item) => item.chatJid === chatJid && item.status === 'proposed')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getActionProposalById(id: string): ActionProposalRecord | null {
  const item = readActionQueue().find((entry) => entry.id === id);
  return item || null;
}

export function decideActionProposal(
  id: string,
  decision: 'approved' | 'denied',
  decisionReason?: string,
): ActionProposalRecord | null {
  const queue = readActionQueue();
  const target = queue.find((item) => item.id === id);
  if (!target || target.status !== 'proposed') return null;
  target.status = decision;
  target.decidedAt = new Date().toISOString();
  if (decisionReason) {
    target.decisionReason = decisionReason;
  }
  writeActionQueue(queue);
  return target;
}
