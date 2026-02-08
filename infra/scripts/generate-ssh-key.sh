#!/bin/bash
#
# Generate restricted SSH key for AI Ops
#

set -euo pipefail

KEY_DIR="$(dirname "$0")/../keys"
KEY_NAME="aiops"

mkdir -p "$KEY_DIR"

echo "🔑 Generating SSH key for AI Ops..."
echo "   Location: $KEY_DIR/$KEY_NAME"

# Generate Ed25519 key
ssh-keygen -t ed25519 -f "$KEY_DIR/$KEY_NAME" -N "" -C "aiops@nanoclaw"

echo "✅ Key generated!"
echo ""
echo "Public key:"
cat "$KEY_DIR/$KEY_NAME.pub"
echo ""
echo "Next steps:"
echo "1. Copy the public key to target authorized_keys files"
echo "2. Add ForceCommand restriction (see install-gatekeeper.sh)"
echo "3. Update .env with SSH_KEY_PATH=/app/keys/aiops"
