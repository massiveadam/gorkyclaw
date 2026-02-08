#!/bin/bash
#
# Start NanoClaw properly - avoids duplicate instances
#

cd /home/adam/nanoclaw

# Kill any existing instances
echo "🔪 Killing existing instances..."
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1

# Verify no instances running
if pgrep -f "node dist/index.js" > /dev/null; then
    echo "ERROR: Failed to kill existing instances"
    exit 1
fi

echo "🚀 Starting NanoClaw..."

# Start with environment from .env file
nohup env $(cat .env | grep -v '^#' | grep -v '^$' | xargs) node dist/index.js > /tmp/nanoclaw.log 2>&1 &

sleep 2

# Check if running
if ps aux | grep "dist/index.js" | grep -v grep > /dev/null; then
    echo "✅ NanoClaw started successfully"
    ps aux | grep "dist/index.js" | grep -v grep
else
    echo "❌ Failed to start NanoClaw"
    cat /tmp/nanoclaw.log | tail -20
fi
