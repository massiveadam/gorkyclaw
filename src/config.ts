import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Gorky';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || '';
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const MAX_CONCURRENT_CONTAINERS = parseInt(
  process.env.MAX_CONCURRENT_CONTAINERS || '4',
  10,
);
export const IPC_POLL_INTERVAL = 1000;
export const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '';
export const OBSIDIAN_MEMORY_DIRS = (process.env.OBSIDIAN_MEMORY_DIRS || 'Memory,Projects')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
export const OBSIDIAN_MEMORY_MAX_SNIPPETS = parseInt(
  process.env.OBSIDIAN_MEMORY_MAX_SNIPPETS || '5',
  10,
);
export const OBSIDIAN_MEMORY_MAX_CHARS = parseInt(
  process.env.OBSIDIAN_MEMORY_MAX_CHARS || '1200',
  10,
);
export const OBSIDIAN_MEMORY_MAX_FILES = parseInt(
  process.env.OBSIDIAN_MEMORY_MAX_FILES || '1500',
  10,
);
export const OBSIDIAN_MEMORY_CACHE_MS = parseInt(
  process.env.OBSIDIAN_MEMORY_CACHE_MS || '60000',
  10,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Channel configuration (telegram or whatsapp)
export const CHANNEL = process.env.CHANNEL || 'whatsapp';
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
export const PLANNER_BACKEND = (process.env.PLANNER_BACKEND || 'direct').toLowerCase();

// Approval-gated external dispatch (disabled by default)
export const ENABLE_APPROVED_EXECUTION =
  (process.env.ENABLE_APPROVED_EXECUTION || 'false').toLowerCase() === 'true';
export const APPROVED_ACTION_WEBHOOK_URL =
  process.env.APPROVED_ACTION_WEBHOOK_URL || '';
export const APPROVED_ACTION_WEBHOOK_TIMEOUT_MS = parseInt(
  process.env.APPROVED_ACTION_WEBHOOK_TIMEOUT_MS || '10000',
  10,
);
export const APPROVED_ACTION_WEBHOOK_SECRET =
  process.env.APPROVED_ACTION_WEBHOOK_SECRET || '';
export const OPS_RUNNER_URL = process.env.OPS_RUNNER_URL || 'http://127.0.0.1:8080';
export const OPS_RUNNER_SHARED_SECRET = process.env.OPS_RUNNER_SHARED_SECRET || '';
// Local execution remains opt-in and disabled by default.
export const ENABLE_LOCAL_APPROVED_EXECUTION =
  (process.env.ENABLE_LOCAL_APPROVED_EXECUTION || 'false').toLowerCase() === 'true';
export const EXEC_SSH_USER = process.env.EXEC_SSH_USER || '';
export const EXEC_SSH_KEY_PATH = process.env.EXEC_SSH_KEY_PATH || '';
export const EXEC_TARGET_WILLIAM_HOST =
  process.env.EXEC_TARGET_WILLIAM_HOST ||
  process.env.TARGET_WILLIAM_IP ||
  '';
export const EXEC_TARGET_UBUNTU_HOST =
  process.env.EXEC_TARGET_UBUNTU_HOST ||
  process.env.TARGET_UBUNTU_IP ||
  '';
export const EXEC_SSH_STRICT_HOST_KEY_CHECKING =
  process.env.EXEC_SSH_STRICT_HOST_KEY_CHECKING || 'accept-new';
