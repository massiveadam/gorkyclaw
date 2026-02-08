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
  }

  createJob(job: Job): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, created_at, status, requested_by_telegram_user_id, requested_by_username,
        requested_by_first_name, requested_by_last_name, plan_json, requires_approval,
        approved_at, approved_by, denied_at, denied_reason, executed_at, results_json, error, notes_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      job.id,
      job.createdAt,
      job.status,
      job.requestedBy.telegramUserId,
      job.requestedBy.username || null,
      job.requestedBy.firstName,
      job.requestedBy.lastName || null,
      JSON.stringify(job.plan),
      job.requiresApproval ? 1 : 0,
      job.approvedAt || null,
      job.approvedBy || null,
      job.deniedAt || null,
      job.deniedReason || null,
      job.executedAt || null,
      job.results ? JSON.stringify(job.results) : null,
      job.error || null,
      job.notesPath || null,
    );
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

  getRecentJobs(limit: number = 50): Job[] {
    const stmt = this.db.prepare(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToJob(row));
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
}
