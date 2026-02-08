/**
 * NanoClaw Agent Runner - Claude Agent SDK Edition
 * Runs inside a container, receives config via stdin, outputs result to stdout
 */

import { query, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { createIpcMcpServer } from './ipc-mcp.js';
import { ensurePlanBlock } from './plan-contract.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function extractAssistantText(message: SDKMessage): string | null {
  if (message.type !== 'assistant') return null;
  const content = message.message?.content;
  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) return null;

  const textParts = content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.output_text === 'string') return part.output_text;
      return '';
    })
    .filter((part) => part.length > 0);

  if (textParts.length === 0) return null;
  return textParts.join('');
}

function coerceResultText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => coerceResultText(v))
      .filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  const directKeys = ['text', 'content', 'output_text', 'result'];
  for (const key of directKeys) {
    const maybe = coerceResultText(obj[key]);
    if (maybe) return maybe;
  }

  return null;
}

function isSuccessResult(
  message: SDKMessage,
): message is SDKResultMessage & { subtype: 'success' } {
  return message.type === 'result' && message.subtype === 'success';
}

function isErrorResult(
  message: SDKMessage,
): message is SDKResultMessage & { subtype: string; errors?: string[] } {
  return (
    message.type === 'result' &&
    message.subtype !== 'success' &&
    message.is_error === true
  );
}

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const ipcMcpServer = createIpcMcpServer({
    chatJid: input.chatJid,
    groupFolder: input.groupFolder,
    isMain: input.isMain,
  });

  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - You are running automatically, not in response to a user message. Use mcp__nanoclaw__send_message if needed to communicate with the user.]\n\n${input.prompt}`;
  }

  let result: string | null = null;
  let newSessionId: string | undefined = input.sessionId;
  let lastAssistantText: string | null = null;

  try {
    log('Starting agent...');

    const options = {
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
      tools: { type: 'preset' as const, preset: 'claude_code' as const },
      settingSources: ['project' as const],
      mcpServers: {
        nanoclaw: ipcMcpServer,
      },
      permissionMode: 'default' as const,
      resume: input.sessionId,
    };

    const stream = query({ prompt, options });

    for await (const message of stream) {
      const assistantText = extractAssistantText(message);
      if (assistantText) lastAssistantText = assistantText;

      if (isSuccessResult(message)) {
        result = coerceResultText(message.result) || result;
        newSessionId = message.session_id || newSessionId;
      } else if (isErrorResult(message)) {
        const errorText = message.errors?.join('; ') || 'Agent error';
        throw new Error(errorText);
      }
    }

    if (!result && lastAssistantText) {
      result = lastAssistantText;
    }

    if (!result) {
      // Some OpenRouter free models can complete without a parseable final text payload.
      // Return a deterministic non-empty fallback so host flow does not emit blank output.
      result = 'I could not generate a complete answer. Please retry.';
    }

    if (result) {
      result = ensurePlanBlock(result);
    }

    log('Agent completed successfully');
    writeOutput({
      status: 'success',
      result,
      newSessionId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      log(`Agent stack: ${err.stack}`);
    }
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: input.sessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
