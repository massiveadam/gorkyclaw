/**
 * Shared Types and Schemas - Ops Runner
 */

import { z } from 'zod';

// Action Types
export const ActionType = z.enum([
  'ssh',
  'obsidian_write',
  'web_fetch',
  'notify',
]);
export type ActionType = z.infer<typeof ActionType>;

// Risk Levels
export const RiskLevel = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

// Action Schema
const BaseActionSchema = z.object({
  id: z.string().optional(),
  type: ActionType,
  risk: RiskLevel.default('low'),
  requiresApproval: z.boolean().default(true),
  reason: z.string(),
  timeout: z.number().optional(),
});

const SSHActionSchema = BaseActionSchema.extend({
  type: z.literal('ssh'),
  target: z.enum(['william', 'willy-ubuntu']),
  command: z.string().min(1),
});

const ObsidianWriteActionSchema = BaseActionSchema.extend({
  type: z.literal('obsidian_write'),
  path: z.string().min(1),
  patch: z.string().min(1),
});

const WebFetchActionSchema = BaseActionSchema.extend({
  type: z.literal('web_fetch'),
  url: z.string().url(),
  mode: z.enum(['http', 'browser']).default('http'),
  extract: z.string().optional(),
});

const NotifyActionSchema = BaseActionSchema.extend({
  type: z.literal('notify'),
  message: z.string().min(1),
});

export const ActionSchema = z.discriminatedUnion('type', [
  SSHActionSchema,
  ObsidianWriteActionSchema,
  WebFetchActionSchema,
  NotifyActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

// Plan Schema
export const PlanSchema = z.object({
  version: z.literal('1.0'),
  summary: z.string(),
  actions: z.array(ActionSchema).min(1),
  estimatedDuration: z.number().optional(),
});

export type Plan = z.infer<typeof PlanSchema>;

// Job Status
export const JobStatus = z.enum([
  'proposed',
  'approved',
  'denied',
  'executing',
  'executed',
  'failed',
  'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

// Job Schema
export const JobSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  status: JobStatus,
  requestedBy: z.object({
    telegramUserId: z.number(),
    username: z.string().optional(),
    firstName: z.string(),
    lastName: z.string().optional(),
  }),
  plan: PlanSchema,
  requiresApproval: z.boolean(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.number().optional(),
  deniedAt: z.string().datetime().optional(),
  deniedReason: z.string().optional(),
  executedAt: z.string().datetime().optional(),
  results: z
    .array(
      z.object({
        actionId: z.string(),
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number(),
        executedAt: z.string().datetime(),
        durationMs: z.number(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  notesPath: z.string().optional(),
});

export type Job = z.infer<typeof JobSchema>;

// API Types
export const RunJobRequestSchema = z.object({
  jobId: z.string(),
  sharedSecret: z.string(),
});

export type RunJobRequest = z.infer<typeof RunJobRequestSchema>;
