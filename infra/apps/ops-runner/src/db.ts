/**
 * Database Layer for Jobs - Using Bun's built-in SQLite
 */

import { Database } from 'bun:sqlite';
import type { Job, JobStatus } from './types.js';

const DB_PATH = process.env.DB_PATH || '/app/data/jobs.db';

export class JobsDatabase {
  private db: Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL;');
    this.initTables();
  }

  private initTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by_telegram_user_id INTEGER NOT NULL,
        requested_by_username TEXT,
        requested_by_first_name TEXT NOT NULL,
        requested_by_last_name TEXT,
        plan_json TEXT NOT NULL,
        requires_approval BOOLEAN NOT NULL DEFAULT 1,
        approved_at TEXT,
        approved_by INTEGER,
        denied_at TEXT,
        denied_reason TEXT,
        executed_at TEXT,
        results_json TEXT,
        error TEXT,
        notes_path TEXT
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)`,
    );

    this.db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        summary TEXT,
        result_text TEXT,
        error_text TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at)`);
  }

  getJob(id: string): Job | null {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToJob(row);
  }

  updateJobStatus(
    id: string,
    status: JobStatus,
    updates: Partial<Job> = {},
  ): void {
    const setClauses: string[] = ['status = ?'];
    const values: (string | number | null)[] = [status];

    if (updates.approvedAt) {
      setClauses.push('approved_at = ?');
      values.push(updates.approvedAt);
    }
    if (updates.approvedBy) {
      setClauses.push('approved_by = ?');
      values.push(updates.approvedBy);
    }
    if (updates.deniedAt) {
      setClauses.push('denied_at = ?');
      values.push(updates.deniedAt);
    }
    if (updates.deniedReason) {
      setClauses.push('denied_reason = ?');
      values.push(updates.deniedReason);
    }
    if (updates.executedAt) {
      setClauses.push('executed_at = ?');
      values.push(updates.executedAt);
    }
    if (updates.results) {
      setClauses.push('results_json = ?');
      values.push(JSON.stringify(updates.results));
    }
    if (updates.error) {
      setClauses.push('error = ?');
      values.push(updates.error);
    }
    if (updates.notesPath) {
      setClauses.push('notes_path = ?');
      values.push(updates.notesPath);
    }

    values.push(id);
    const sql = `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`;
    // Bun SQLite typings are strict here; runtime accepts variadic bindings.
    (this.db as any).run(sql, ...values);
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      createdAt: row.created_at as string,
      status: row.status as JobStatus,
      requestedBy: {
        telegramUserId: row.requested_by_telegram_user_id as number,
        username: row.requested_by_username as string | undefined,
        firstName: row.requested_by_first_name as string,
        lastName: row.requested_by_last_name as string | undefined,
      },
      plan: JSON.parse(row.plan_json as string),
      requiresApproval: Boolean(row.requires_approval),
      approvedAt: row.approved_at as string | undefined,
      approvedBy: row.approved_by as number | undefined,
      deniedAt: row.denied_at as string | undefined,
      deniedReason: row.denied_reason as string | undefined,
      executedAt: row.executed_at as string | undefined,
      results: row.results_json
        ? JSON.parse(row.results_json as string)
        : undefined,
      error: row.error as string | undefined,
      notesPath: row.notes_path as string | undefined,
    };
  }

  close(): void {
    this.db.close();
  }

  createRun(input: {
    id: string;
    actionType: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: string;
    summary?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, action_type, status, created_at, summary)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.id,
      input.actionType,
      input.status,
      input.createdAt,
      input.summary || null,
    );
  }

  updateRun(
    id: string,
    updates: Partial<{
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      startedAt: string;
      completedAt: string;
      resultText: string;
      errorText: string;
      cancelRequested: boolean;
    }>,
  ): void {
    const setClauses: string[] = [];
    const values: (string | number)[] = [];

    if (updates.status) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.startedAt) {
      setClauses.push('started_at = ?');
      values.push(updates.startedAt);
    }
    if (updates.completedAt) {
      setClauses.push('completed_at = ?');
      values.push(updates.completedAt);
    }
    if (typeof updates.resultText === 'string') {
      setClauses.push('result_text = ?');
      values.push(updates.resultText);
    }
    if (typeof updates.errorText === 'string') {
      setClauses.push('error_text = ?');
      values.push(updates.errorText);
    }
    if (typeof updates.cancelRequested === 'boolean') {
      setClauses.push('cancel_requested = ?');
      values.push(updates.cancelRequested ? 1 : 0);
    }

    if (setClauses.length === 0) return;
    values.push(id);
    const sql = `UPDATE runs SET ${setClauses.join(', ')} WHERE id = ?`;
    (this.db as any).run(sql, ...values);
  }

  getRun(id: string): Record<string, unknown> | null {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    return (stmt.get(id) as Record<string, unknown> | null) || null;
  }

  listRuns(limit: number = 20): Record<string, unknown>[] {
    const stmt = this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as Record<string, unknown>[];
  }
}
