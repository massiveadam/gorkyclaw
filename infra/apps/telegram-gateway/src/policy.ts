/**
 * Policy Engine
 * Validates commands against allowlist and determines approval requirements
 */

import { z } from 'zod';
import {
  type Action,
  type PolicyConfig,
  RiskLevel,
  PolicyConfigSchema,
} from './types.js';

export type RiskLevelType = z.infer<typeof RiskLevel>;

// Default policy configuration
const DEFAULT_POLICY: PolicyConfig = {
  targets: {
    william: {
      allowlist: [
        // Safe diagnostics - no approval needed
        {
          pattern: '^uptime$',
          description: 'System uptime',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^df\\s+-h$',
          description: 'Disk usage',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^free\\s+-m$',
          description: 'Memory usage',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^top\\s+-bn1$',
          description: 'Process list',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^ps\\s+aux$',
          description: 'Process list',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^docker\\s+ps$',
          description: 'Docker containers',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^docker\\s+logs\\s+--tail\\s+\\d+',
          description: 'Docker logs',
          action: 'allow',
          risk: 'low',
        },
        {
          pattern: '^docker\\s+stats\\s+--no-stream$',
          description: 'Docker stats',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^ls\\s+-la?$',
          description: 'List directory',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^cat\\s+[^;|&]+$',
          description: 'Read file',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^systemctl\\s+status\\s+\\w+$',
          description: 'Service status',
          action: 'allow',
          risk: 'none',
        },

        // Potentially risky - require approval
        {
          pattern: '^docker\\s+(restart|stop|start|kill)',
          description: 'Docker control',
          action: 'require_approval',
          risk: 'medium',
        },
        {
          pattern: '^systemctl\\s+(restart|stop|start|reload)',
          description: 'Service control',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^rm\\s+',
          description: 'Remove files',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^apt\\s+(install|remove|upgrade|update)',
          description: 'Package management',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^reboot$',
          description: 'Reboot system',
          action: 'require_approval',
          risk: 'critical',
        },
        {
          pattern: '^shutdown',
          description: 'Shutdown system',
          action: 'require_approval',
          risk: 'critical',
        },

        // Dangerous - blocked entirely
        {
          pattern: '^bash\\s+-i',
          description: 'Interactive shell',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^rm\\s+-rf\\s+/',
          description: 'Recursive delete root',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^dd\\s+if=',
          description: 'Disk write',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^mkfs',
          description: 'Filesystem format',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^>:?\\s*/dev',
          description: 'Device overwrite',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '[;&|]\\s*rm',
          description: 'Chained remove',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '\\$\\(',
          description: 'Command substitution',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '\`.*\`',
          description: 'Backtick execution',
          action: 'deny',
          risk: 'critical',
        },
      ],
      defaultAction: 'require_approval',
    },
    'willy-ubuntu': {
      allowlist: [
        // Same patterns for willy-ubuntu
        {
          pattern: '^uptime$',
          description: 'System uptime',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^df\\s+-h$',
          description: 'Disk usage',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^free\\s+-m$',
          description: 'Memory usage',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^top\\s+-bn1$',
          description: 'Process list',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^ps\\s+aux$',
          description: 'Process list',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^docker\\s+ps$',
          description: 'Docker containers',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^docker\\s+logs\\s+--tail\\s+\\d+',
          description: 'Docker logs',
          action: 'allow',
          risk: 'low',
        },
        {
          pattern: '^docker\\s+stats\\s+--no-stream$',
          description: 'Docker stats',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^ls\\s+-la?$',
          description: 'List directory',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^cat\\s+[^;|&]+$',
          description: 'Read file',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^systemctl\\s+status\\s+\\w+$',
          description: 'Service status',
          action: 'allow',
          risk: 'none',
        },
        {
          pattern: '^journalctl\\s+--since',
          description: 'System logs',
          action: 'allow',
          risk: 'low',
        },
        {
          pattern: '^tail\\s+-n\\s+\\d+',
          description: 'Tail logs',
          action: 'allow',
          risk: 'none',
        },

        // Require approval
        {
          pattern: '^docker\\s+(restart|stop|start|kill)',
          description: 'Docker control',
          action: 'require_approval',
          risk: 'medium',
        },
        {
          pattern: '^systemctl\\s+(restart|stop|start|reload)',
          description: 'Service control',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^rm\\s+',
          description: 'Remove files',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^apt\\s+(install|remove|upgrade|update)',
          description: 'Package management',
          action: 'require_approval',
          risk: 'high',
        },
        {
          pattern: '^reboot$',
          description: 'Reboot system',
          action: 'require_approval',
          risk: 'critical',
        },

        // Blocked
        {
          pattern: '^bash\\s+-i',
          description: 'Interactive shell',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^rm\\s+-rf\\s+/',
          description: 'Recursive delete root',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^dd\\s+if=',
          description: 'Disk write',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '^mkfs',
          description: 'Filesystem format',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '\\$\\(',
          description: 'Command substitution',
          action: 'deny',
          risk: 'critical',
        },
        {
          pattern: '\`.*\`',
          description: 'Backtick execution',
          action: 'deny',
          risk: 'critical',
        },
      ],
      defaultAction: 'require_approval',
    },
  },
  diagnostics: {
    allowedWithoutApproval: true,
    patterns: [
      '^uptime$',
      '^df\\s+-h$',
      '^free\\s+-m$',
      '^top\\s+-bn1$',
      '^ps\\s+aux$',
      '^docker\\s+ps$',
      '^docker\\s+stats',
      '^ls\\s+-',
      '^cat\\s+',
      '^systemctl\\s+status',
    ],
  },
};

export interface ValidationResult {
  allowed: boolean;
  requiresApproval: boolean;
  risk: RiskLevelType;
  reason: string;
  matchedRule?: string;
}

export class PolicyEngine {
  private policy: PolicyConfig;

  constructor(customPolicy?: PolicyConfig) {
    this.policy = customPolicy || DEFAULT_POLICY;
  }

  validateAction(action: Action): ValidationResult {
    if (action.type !== 'ssh') {
      // Non-SSH actions (obsidian_write, web_fetch) have their own validation
      return {
        allowed: true,
        requiresApproval: action.requiresApproval,
        risk: action.risk,
        reason: 'Non-SSH action type',
      };
    }

    if (!action.target) {
      return {
        allowed: false,
        requiresApproval: true,
        risk: 'high',
        reason: 'SSH action missing target',
      };
    }

    const targetConfig = this.policy.targets[action.target];
    if (!targetConfig) {
      return {
        allowed: false,
        requiresApproval: true,
        risk: 'high',
        reason: `Unknown target: ${action.target}`,
      };
    }

    // Check against allowlist
    for (const rule of targetConfig.allowlist) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(action.command)) {
        return {
          allowed: rule.action !== 'deny',
          requiresApproval:
            rule.action === 'require_approval' ||
            (rule.action === 'allow' && action.requiresApproval),
          risk: rule.risk,
          reason: rule.description,
          matchedRule: rule.pattern,
        };
      }
    }

    // No rule matched - use default action
    return {
      allowed: targetConfig.defaultAction !== 'deny',
      requiresApproval: targetConfig.defaultAction === 'require_approval',
      risk: 'medium',
      reason: `No specific rule matched, using default: ${targetConfig.defaultAction}`,
    };
  }

  isDiagnosticCommand(command: string): boolean {
    return this.policy.diagnostics.patterns.some((pattern) => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(command);
    });
  }

  canRunWithoutApproval(action: Action): boolean {
    if (!this.policy.diagnostics.allowedWithoutApproval) {
      return false;
    }

    if (action.type !== 'ssh') {
      return false; // Non-SSH actions always require approval
    }

    return this.isDiagnosticCommand(action.command);
  }
}
