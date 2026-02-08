# OpenClaw Security Model

## Overview

OpenClaw implements a **defense-in-depth** security architecture with multiple layers of protection for autonomous operations.

## Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Tailscale Transport (Encrypted Mesh Network)           │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Telegram Gateway (User Auth, Policy Check)             │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Human-in-the-Loop (Approval for mutating actions)      │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4: Ops Runner (Network Isolation, Shared Secret)          │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5: SSH Hardening (Restricted Keys, ForceCommand)          │
├─────────────────────────────────────────────────────────────────┤
│ Layer 6: Gatekeeper (Command Allowlist, No Eval)                │
└─────────────────────────────────────────────────────────────────┘
```

## Layer 1: Tailscale Transport

All communication uses Tailscale's encrypted mesh network:

- **100.x IPs only**: No services exposed to LAN or public internet
- **WireGuard encryption**: All traffic encrypted in transit
- **Access controls**: Tailscale ACLs restrict which nodes can communicate

### Configuration

```bash
# Target hosts (from .env)
TARGET_WILLIAM_IP=100.70.173.74
TARGET_UBUNTU_IP=100.108.37.10
```

## Layer 2: Telegram Gateway

The gateway enforces user authentication and policy validation:

### User Authentication

```typescript
// Only whitelisted Telegram users can access
((TELEGRAM_ALLOWED_USER_IDS = 12345678), 87654321);
```

### Policy Engine

Commands are validated against allowlists:

- **Diagnostics**: Auto-approved (uptime, df -h, docker ps, etc.)
- **Operations**: Require human approval (docker restart, systemctl, etc.)
- **Dangerous**: Blocked entirely (bash -i, rm -rf /, etc.)

See `apps/telegram-gateway/src/policy.ts` for full allowlist.

## Layer 3: Human-in-the-Loop

Mutating actions require explicit approval:

1. User sends command: "Restart nginx on william"
2. Gateway presents plan with Approve/Deny buttons
3. Action only executes after human approval
4. All approvals logged with user identity

### Approval Flow

```
User Command
    ↓
NanoClaw Plan Generation
    ↓
Policy Check → If safe: Auto-execute
    ↓
Telegram Inline Buttons (Approve/Deny)
    ↓
Ops Runner (on approval)
    ↓
SSH Execution
```

## Layer 4: Ops Runner

The ops-runner service provides execution isolation:

### Network Isolation

- Runs in separate Docker container
- No direct internet access
- Only internal network to gateway

### Authentication

```typescript
// Shared secret required for all job requests
OPS_RUNNER_SHARED_SECRET = random_secret_here;

// Request validation
if (sharedSecret !== process.env.OPS_RUNNER_SHARED_SECRET) {
  return unauthorized();
}
```

### Job Validation

- Verifies job status is "approved"
- Re-executes policy checks
- Validates command against allowlist

## Layer 5: SSH Hardening

SSH access uses restricted keys with ForceCommand:

### Authorized Keys Format

```
no-pty,no-X11-forwarding,no-agent-forwarding,no-port-forwarding,command="/usr/local/sbin/aiops-gatekeeper" ssh-ed25519 AAAAC3...
```

### Restrictions

| Option                | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `no-pty`              | Prevents interactive shells                 |
| `no-X11-forwarding`   | Blocks X11 tunneling                        |
| `no-agent-forwarding` | Blocks SSH agent forwarding                 |
| `no-port-forwarding`  | Blocks port tunnels                         |
| `command=...`         | Forces command execution through gatekeeper |

## Layer 6: Gatekeeper

The gatekeeper script validates all commands server-side:

### Installation

```bash
# On target hosts (william, willy-ubuntu)
./scripts/install-gatekeeper.sh
```

### Validation Rules

**Allowed Patterns:**

- `^uptime$` - System uptime
- `^docker ps$` - Container list
- `^systemctl status \w+$` - Service status

**Blocked Patterns:**

- `bash -i` - Interactive shells
- `rm -rf /` - Recursive root delete
- `[;&|]` - Command chaining
- `$(` - Command substitution

### No Eval

Commands are executed without shell evaluation:

```bash
# ❌ DANGEROUS - Allows injection
eval "$SSH_ORIGINAL_COMMAND"

# ✅ SAFE - Direct execution
exec bash -c "$SSH_ORIGINAL_COMMAND"
```

## Audit Logging

All operations are logged at multiple levels:

### 1. Syslog (Target Hosts)

```bash
# Gatekeeper logs to syslog
logger -t aiops-gatekeeper -p auth.info "ALLOWED: uptime"

# View logs
journalctl -t aiops-gatekeeper -f
```

### 2. SQLite Database

```sql
-- Jobs table tracks all operations
SELECT id, status, requested_by, executed_at
FROM jobs
WHERE status = 'executed';
```

### 3. Obsidian Vault

Daily logs in `Ops Logs/YYYY-MM-DD.md`:

```markdown
## Job abc123def

- **Status:** executed
- **Time:** 2026-02-06T10:30:00Z
- **Requested by:** Adam (@adam_user)
- **Summary:** Check uptime on william

### Actions

**1. SSH** → `william`

- Command: `uptime`
- Risk: none
- Result: Exit code 0
```

## Threat Model

### Attacker Scenarios

| Threat                       | Mitigation                           |
| ---------------------------- | ------------------------------------ | ----- |
| Telegram account compromised | User ID whitelist limits impact      |
| Ops runner compromised       | Shared secret + network isolation    |
| SSH key stolen               | ForceCommand restricts to gatekeeper |
| Gatekeeper bypassed          | No eval, strict regex patterns       |
| Command injection            | Blocked characters: `;&              | \$\`` |
| Privilege escalation         | Dedicated aiops user, no sudo        |

### Residual Risks

- **Allowlist bypass**: Complex regex may have edge cases
- **Gatekeeper bugs**: Script errors could allow unintended execution
- **Tailscale compromise**: If Tailscale keys stolen, network is exposed

## Security Checklist

### Deployment

- [ ] Generate unique SSH key pair for aiops user
- [ ] Install gatekeeper on all target hosts
- [ ] Configure authorized_keys with ForceCommand
- [ ] Set strong OPS_RUNNER_SHARED_SECRET (32+ chars)
- [ ] Whitelist specific Telegram user IDs
- [ ] Verify Tailscale ACLs restrict node access

### Operations

- [ ] Monitor syslog for blocked commands
- [ ] Review Obsidian logs regularly
- [ ] Rotate SSH keys quarterly
- [ ] Audit job database for anomalies
- [ ] Test denial of dangerous commands

## Incident Response

### If SSH Key Compromised

1. Remove public key from all authorized_keys files
2. Generate new key pair
3. Update docker-compose.yml volume mount
4. Restart ops-runner container
5. Review job logs for unauthorized activity

### If Suspicious Activity Detected

1. Stop ops-runner: `docker-compose stop ops-runner`
2. Check job database for recent executions
3. Review target host syslogs
4. Verify Obsidian logs match expected operations

## References

- [Tailscale Security](https://tailscale.com/security)
- [SSH ForceCommand](https://man.openbsd.org/sshd.8#ForceCommand)
- [Defense in Depth](<https://en.wikipedia.org/wiki/Defense_in_depth_(computing)>)
