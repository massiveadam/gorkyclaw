/**
 * MCP-Obsidian Integration
 * Obsidian REST API client for advanced vault operations
 * Requires obsidian-local-rest-api plugin
 */

import type { Job } from './types.js';

export interface ObsidianNote {
  path: string;
  content: string;
  mtime: number;
}

export class MCPObsidianClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string = 'http://localhost:27123', apiKey: string = '') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Obsidian API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Search vault using Obsidian's search
   */
  async search(
    query: string,
  ): Promise<Array<{ filename: string; path: string; matches: string[] }>> {
    return this.request(`/search?q=${encodeURIComponent(query)}`);
  }

  /**
   * Read a note by path
   */
  async readNote(path: string): Promise<ObsidianNote> {
    return this.request(`/vault/${encodeURIComponent(path)}`);
  }

  /**
   * Write a note
   */
  async writeNote(path: string, content: string): Promise<void> {
    await this.request(`/vault/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  /**
   * Append to a note
   */
  async appendToNote(path: string, content: string): Promise<void> {
    await this.request(`/vault/${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  /**
   * List all files in vault
   */
  async listFiles(): Promise<string[]> {
    return this.request('/vault/');
  }

  /**
   * Log a job to Obsidian
   */
  async logJob(job: Job): Promise<string> {
    const date = new Date();
    const fileName = `Ops Logs/${date.toISOString().split('T')[0]}.md`;

    const entry = this.formatJobEntry(job);

    try {
      // Try to append first
      await this.appendToNote(fileName, entry);
    } catch {
      // If file doesn't exist, create it
      await this.writeNote(
        fileName,
        `# Ops Log - ${date.toISOString().split('T')[0]}\n\n${entry}`,
      );
    }

    return fileName;
  }

  private formatJobEntry(job: Job): string {
    const timestamp = new Date().toISOString();

    let entry = `\n## Job ${job.id.slice(0, 8)}\n\n`;
    entry += `- **Status:** ${job.status}\n`;
    entry += `- **Time:** ${timestamp}\n`;
    entry += `- **Requested by:** ${job.requestedBy.firstName}\n`;
    entry += `- **Summary:** ${job.plan.summary}\n\n`;

    job.plan.actions.forEach((action, i) => {
      entry += `**${i + 1}. ${action.type.toUpperCase()}**`;
      if (action.type === 'ssh') entry += ` → \`${action.target}\``;
      entry += `\n`;
      entry += `- Command: \`${this.actionCommand(action)}\`\n`;
      entry += `- Risk: ${action.risk}\n\n`;
    });

    if (job.results) {
      job.results.forEach((result, i) => {
        entry += `**Action ${i + 1} Result:**\n`;
        entry += `- Exit code: ${result.exitCode}\n`;
        if (result.stdout)
          entry += `- Output: \`${result.stdout.slice(0, 200)}\`\n`;
        entry += '\n';
      });
    }

    entry += `---\n`;
    return entry;
  }

  private actionCommand(action: Job['plan']['actions'][number]): string {
    switch (action.type) {
      case 'ssh':
        return action.command;
      case 'web_fetch':
        return `${action.mode} ${action.url}`;
      case 'obsidian_write':
        return `write ${action.path}`;
      case 'notify':
        return action.message;
      default:
        return 'action';
    }
  }
}

/**
 * Factory to create appropriate Obsidian client
 * Falls back to filesystem if MCP not available
 */
export function createObsidianClient(
  vaultPath: string,
  mcpUrl?: string,
  mcpKey?: string,
) {
  if (mcpUrl) {
    return new MCPObsidianClient(mcpUrl, mcpKey);
  }
  // Return null to indicate filesystem mode
  return null;
}
