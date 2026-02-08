#!/bin/bash
#
# AI Ops Gatekeeper Installation Script
# Installs SSH ForceCommand gatekeeper on target systems
#

set -euo pipefail

GATEKEEPER_DIR="/usr/local/sbin"
GATEKEEPER_BIN="${GATEKEEPER_DIR}/aiops-gatekeeper"
SSH_USER="aiops"
SSH_KEY_PATH=""

echo "🔒 AI Ops Gatekeeper Installer"
echo "==============================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root"
   exit 1
fi

# Create aiops user if doesn't exist
if ! id "$SSH_USER" &>/dev/null; then
    echo "👤 Creating user: $SSH_USER"
    useradd -r -s /bin/false -d /var/lib/aiops -m "$SSH_USER"
else
    echo "👤 User exists: $SSH_USER"
fi

# Create gatekeeper script
echo "📝 Installing gatekeeper..."
cat > "$GATEKEEPER_BIN" << 'GATEKEEPER_EOF'
#!/bin/bash
#
# AI Ops Gatekeeper
# Validates and logs SSH commands from AI ops runner
#

readonly SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}"
readonly LOG_TAG="aiops-gatekeeper"
readonly ALLOWED_PATTERNS=(
    # Diagnostics (safe)
    '^uptime$'
    '^df[[:space:]]+-h$'
    '^free[[:space:]]+-m$'
    '^top[[:space:]]+-bn1$'
    '^ps[[:space:]]+aux$'
    '^docker[[:space:]]+ps$'
    '^docker[[:space:]]+stats[[:space:]]+--no-stream$'
    '^docker[[:space:]]+logs[[:space:]]+--tail[[:space:]]+[0-9]+'
    '^ls[[:space:]]+-la?$'
    '^cat[[:space:]]+[^;|&<>]+$'
    '^systemctl[[:space:]]+status[[:space:]]+[a-zA-Z0-9_-]+$'
    '^journalctl[[:space:]]+--since'
    '^tail[[:space:]]+-n[[:space:]]+[0-9]+'
    '^head[[:space:]]+-n[[:space:]]+[0-9]+'
    '^grep'
    '^find[[:space:]]+[^;|&<>]+[[:space:]]+-name'
    
    # Operations (risky but allowed with approval)
    '^docker[[:space:]]+(restart|stop|start|kill)[[:space:]]+[a-zA-Z0-9_-]+$'
    '^systemctl[[:space:]]+(restart|stop|start|reload)[[:space:]]+[a-zA-Z0-9_-]+$'
    '^rm[[:space:]]+-[rf]+[[:space:]]+[a-zA-Z0-9_/.-]+$'
    '^apt[[:space:]]+(install|remove|upgrade|update)'
    
    # Specific allowed paths
    '^cat[[:space:]]+/var/log/[a-zA-Z0-9_/.-]+$'
    '^tail[[:space:]]+-f[[:space:]]+/var/log/[a-zA-Z0-9_/.-]+$'
)

readonly BLOCKED_PATTERNS=(
    # Interactive shells
    '^bash[[:space:]]+-i'
    '^sh[[:space:]]+-i'
    '^zsh[[:space:]]+-i'
    
    # Dangerous filesystem operations
    '^rm[[:space:]]+-rf[[:space:]]+/.*'
    '^dd[[:space:]]+if='
    '^mkfs'
    
    # Device writes
    '^>:?[[:space:]]*/dev/'
    
    # Command injection
    '[;&|]'
    '\$\('
    '`'
    '\$\{'
    '<('
    
    # Sudo
    '^sudo'
    '^su[[:space:]]+-'
    
    # Network
    '^nc[[:space:]]+-l'
    '^ncat[[:space:]]+-l'
    '^netcat[[:space:]]+-l'
)

# Logging function
log() {
    local level="$1"
    shift
    logger -t "$LOG_TAG" -p "auth.${level}" "$@"
}

# Validate command against patterns
validate_command() {
    local cmd="$1"
    
    # Check blocked patterns first
    for pattern in "${BLOCKED_PATTERNS[@]}"; do
        if echo "$cmd" | grep -qE "$pattern"; then
            log "err" "BLOCKED: Command matches forbidden pattern '$pattern': $cmd"
            echo "ERROR: Command blocked by security policy" >&2
            exit 1
        fi
    done
    
    # Check allowed patterns
    for pattern in "${ALLOWED_PATTERNS[@]}"; do
        if echo "$cmd" | grep -qE "^${pattern}$"; then
            log "info" "ALLOWED: Pattern '$pattern' matched: $cmd"
            return 0
        fi
    done
    
    # No pattern matched - deny by default
    log "warning" "DENIED: No allowlist pattern matched: $cmd"
    echo "ERROR: Command not in allowlist" >&2
    exit 1
}

# Main
echo "SSH_ORIGINAL_COMMAND: ${SSH_ORIGINAL_COMMAND}" | log debug

if [[ -z "$SSH_ORIGINAL_COMMAND" ]]; then
    log "err" "REJECTED: Empty SSH_ORIGINAL_COMMAND"
    echo "ERROR: No command specified" >&2
    exit 1
fi

# Validate and execute
validate_command "$SSH_ORIGINAL_COMMAND"

log "info" "EXECUTING: $SSH_ORIGINAL_COMMAND"

# Execute command without eval (safe)
exec bash -c "$SSH_ORIGINAL_COMMAND"
GATEKEEPER_EOF

chmod +x "$GATEKEEPER_BIN"
echo "✅ Gatekeeper installed to $GATEKEEPER_BIN"

# Setup SSH directory for aiops user
SSH_DIR="/var/lib/aiops/.ssh"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
chown "$SSH_USER:$SSH_USER" "$SSH_DIR"

# Instructions for authorized_keys
echo ""
echo "📋 Next steps:"
echo "=============="
echo ""
echo "1. Copy the restricted SSH public key to authorized_keys:"
echo "   cat /path/to/aiops.pub >> $SSH_DIR/authorized_keys"
echo ""
echo "2. Set proper permissions:"
echo "   chmod 600 $SSH_DIR/authorized_keys"
echo "   chown $SSH_USER:$SSH_USER $SSH_DIR/authorized_keys"
echo ""
echo "3. Edit $SSH_DIR/authorized_keys and add ForceCommand to the key line:"
echo '   no-pty,no-X11-forwarding,no-agent-forwarding,no-port-forwarding,command="/usr/local/sbin/aiops-gatekeeper" ssh-ed25519 AAAAC3...'
echo ""
echo "4. Test the connection:"
echo "   ssh -i /path/to/aiops -o StrictHostKeyChecking=yes aiops@<target-ip> uptime"
echo ""
echo "✨ Gatekeeper installation complete!"
