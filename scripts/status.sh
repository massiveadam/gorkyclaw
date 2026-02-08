#!/bin/bash
# Quick status check for NanoClaw

echo "=========================================="
echo "NanoClaw Status Check"
echo "=========================================="
echo ""

echo "Docker Status:"
docker info > /dev/null 2>&1 && echo "✅ Docker is running" || echo "❌ Docker is not running"
echo ""

echo "Docker Images:"
docker images | grep nanoclaw || echo "No NanoClaw images found"
echo ""

echo "Service Status:"
systemctl is-active nanoclaw > /dev/null 2>&1 && echo "✅ NanoClaw service is active" || echo "❌ NanoClaw service is not active"
echo ""

echo "Environment File:"
if [ -f /home/adam/nanoclaw/.env ]; then
    echo "✅ .env file exists"
    source /home/adam/nanoclaw/.env
    [ -n "$TELEGRAM_BOT_TOKEN" ] && echo "✅ TELEGRAM_BOT_TOKEN is set" || echo "❌ TELEGRAM_BOT_TOKEN is missing"
    [ -n "$TELEGRAM_ADMIN_CHAT_ID" ] && echo "✅ TELEGRAM_ADMIN_CHAT_ID is set" || echo "❌ TELEGRAM_ADMIN_CHAT_ID is missing"
    [ -n "$OPENROUTER_API_KEY" ] && echo "✅ OPENROUTER_API_KEY is set" || echo "❌ OPENROUTER_API_KEY is missing"
else
    echo "❌ .env file not found"
fi
echo ""

echo "SSH Keys:"
[ -f /home/adam/.ssh/nanoclaw_unraid ] && echo "✅ SSH private key exists" || echo "❌ SSH private key missing"
[ -f /home/adam/.ssh/nanoclaw_unraid.pub ] && echo "✅ SSH public key exists" || echo "❌ SSH public key missing"
echo ""

echo "Obsidian Directory:"
[ -d /home/adam/Obsidian ] && echo "✅ /home/adam/Obsidian exists" || echo "❌ /home/adam/Obsidian not found"
echo ""

echo "Unraid SSH Test:"
ssh -o ConnectTimeout=5 -o BatchMode=yes -i /home/adam/.ssh/nanoclaw_unraid adam@192.168.12.153 "echo 'Connected'" 2>/dev/null && echo "✅ SSH to Unraid works" || echo "❌ SSH to Unraid failed (need to run ssh-copy-id)"
echo ""

echo "Recent Logs (last 10 lines):"
if systemctl is-active nanoclaw > /dev/null 2>&1; then
    journalctl -u nanoclaw --no-pager -n 10
else
    echo "Service not running - no logs available"
fi
echo ""

echo "=========================================="
echo "To complete setup:"
echo "1. Get Telegram Chat ID from @userinfobot"
echo "2. Get OpenRouter API key from openrouter.ai"
echo "3. Copy SSH key to Unraid: ssh-copy-id -i ~/.ssh/nanoclaw_unraid.pub adam@192.168.12.153"
echo "4. Edit .env file with your credentials"
echo "5. Start service: sudo systemctl start nanoclaw"
echo "=========================================="
