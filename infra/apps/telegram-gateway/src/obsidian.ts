/**
 * Obsidian Integration
 * Logs job execution to Obsidian vault
 */

import { type Job } from './types.js';

export class ObsidianLogger {
  private vaultPath: string;
  private opsLogsPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.opsLogsPath = `${vaultPath}/Ops Logs`;
  }

  async logJob(job: Job): Promise<string> {
    const date = new Date();
    const fileName = `${date.toISOString().split('T')[0]}.md`;
    const filePath = `${this.opsLogsPath}/${fileName}`;

    // Build log entry
    const entry = this.buildLogEntry(job);

    // Ensure directory exists
    await this.ensureDirectory(this.opsLogsPath);

    // Append to daily note
    const file = Bun.file(filePath);
    let content = '';

    try {
      content = await file.text();
    } catch {
      // File doesn't exist, will create new
      content = `# Ops Log - ${date.toISOString().split('T')[0]}\n\n`;
    }

    content += entry;

    // Write back
    await Bun.write(filePath, content);

    return filePath;
  }

  private buildLogEntry(job: Job): string {
    const timestamp = new Date().toISOString();

    let entry = `\n## Job ${job.id.slice(0, 8)}\n\n`;
    entry += `- **Status:** ${job.status}\n`;
    entry += `- **Time:** ${timestamp}\n`;
    entry += `- **Requested by:** ${job.requestedBy.firstName} (@${job.requestedBy.username || 'N/A'})\n`;
    entry += `- **Summary:** ${job.plan.summary}\n\n`;

    // Actions
    entry += `### Actions\n\n`;
    job.plan.actions.forEach((action, i) => {
      entry += `**${i + 1}. ${action.type.toUpperCase()}**`;
      if (action.type === 'ssh') entry += ` → \`${action.target}\``;
      entry += `\n`;
      entry += `- Command: \`${this.actionCommand(action)}\`\n`;
      entry += `- Risk: ${action.risk}\n`;
      entry += `- Requires approval: ${action.requiresApproval ? 'Yes' : 'No'}\n`;
      entry += `- Reason: ${action.reason}\n\n`;
    });

    // Results
    if (job.results && job.results.length > 0) {
      entry += `### Results\n\n`;
      job.results.forEach((result, i) => {
        entry += `**Action ${i + 1}:**\n`;
        entry += `- Exit code: ${result.exitCode}\n`;
        entry += `- Duration: ${result.durationMs}ms\n\n`;

        if (result.stdout) {
          entry += `**Output:**\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\`\n\n`;
        }

        if (result.stderr) {
          entry += `**Stderr:**\n\`\`\`\n${result.stderr.slice(0, 1000)}\n\`\`\`\n\n`;
        }
      });
    }

    if (job.error) {
      entry += `### Error\n\n`;
      entry += `\`\`\`\n${job.error}\n\`\`\`\n\n`;
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

  private async ensureDirectory(path: string): Promise<void> {
    try {
      await Bun.file(path).stat();
    } catch {
      // Directory doesn't exist, create it
      await Bun.write(`${path}/.gitkeep`, '');
    }
  }
}
