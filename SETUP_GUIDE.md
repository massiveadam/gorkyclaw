# NanoClaw Setup Guide

## ✅ Completed Steps

1. ✅ Installed Syncthing for Obsidian sync
2. ✅ Generated SSH keys for Unraid
3. ✅ Converted NanoClaw to Docker (Linux support)
4. ✅ Replaced WhatsApp with Telegram
5. ✅ Built TypeScript successfully
6. ✅ Created systemd service file
7. ⏳ Building Docker container (in progress)

## 📋 Next Steps (Manual Configuration Required)

### 1. Copy SSH Key to Unraid

You need to manually copy the SSH public key to your Unraid server:

```bash
ssh-copy-id -i ~/.ssh/nanoclaw_unraid.pub adam@192.168.12.153
```

When prompted, enter your Unraid password.

### 2. Get Your Telegram Chat ID

1. Open Telegram
2. Search for `@userinfobot`
3. Click Start or send any message
4. The bot will reply with your user info including your Chat ID (e.g., `123456789`)
5. Save this number

### 3. Get OpenRouter API Key

1. Go to https://openrouter.ai/
2. Create an account or sign in
3. Go to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-or-...`)

### 4. Configure Environment Variables

Edit `/home/adam/nanoclaw/.env`:

```bash
# Required
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
TELEGRAM_ADMIN_CHAT_ID=YOUR_CHAT_ID_HERE
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY_HERE

# Already configured
UNRAID_HOST=192.168.12.153
UNRAID_USER=adam
UNRAID_KEY_PATH=/home/adam/.ssh/nanoclaw_unraid
```

Replace `YOUR_CHAT_ID_HERE` and `YOUR_OPENROUTER_KEY_HERE` with your actual values.

### 5. Setup Syncthing for Obsidian

1. Access Syncthing Web UI:
   ```bash
   syncthing
   # Then open http://localhost:8384 in your browser
   ```

2. Add your main computer as a device
3. Share your Obsidian vault folder to sync to `/home/adam/Obsidian`

Or, if you prefer, you can continue using the SMB mount at `/mnt/obsidian`

### 6. Install and Start NanoClaw

Once Docker build completes:

```bash
# Copy systemd service
sudo cp /home/adam/nanoclaw/systemd/nanoclaw.service /etc/systemd/system/
sudo systemctl daemon-reload

# Start NanoClaw
sudo systemctl enable nanoclaw
sudo systemctl start nanoclaw

# Check status
sudo systemctl status nanoclaw
journalctl -u nanoclaw -f
```

### 7. Test Telegram Bot

1. Open Telegram
2. Search for your bot (use the username you created with BotFather)
3. Send `/start`
4. Send: `@NanoClaw hello`
5. You should receive a response!

## 🔧 Customization

### Change Assistant Name

Edit `/home/adam/nanoclaw/src/config.ts`:

```typescript
export const ASSISTANT_NAME = 'YourName';
```

Then rebuild:
```bash
cd /home/adam/nanoclaw
npm run build
sudo systemctl restart nanoclaw
```

### Add Custom Tools

Create custom tools in the agent container by modifying the files in `/home/adam/nanoclaw/container/`

### Mount Additional Directories

Edit `/home/adam/nanoclaw/src/config.ts` to add more mount points.

## 🛡️ Security Features

- ✅ Docker container isolation
- ✅ Telegram confirmation for destructive operations (to be implemented)
- ✅ Safe path restrictions
- ✅ SSH key-based authentication only
- ✅ No secrets in code (all in .env file)

## 📝 Usage Examples

Once running, you can message your bot:

```
@NanoClaw create a daily note for today

@NanoClaw check Unraid Docker containers

@NanoClaw search my Obsidian vault for "workout"

@NanoClaw every Monday at 9am, check Unraid array status and message me the results
```

## 🔍 Troubleshooting

### Check logs
```bash
journalctl -u nanoclaw -f
```

### Test Docker manually
```bash
cd /home/adam/nanoclaw
docker run --rm -i nanoclaw-agent:latest echo "Test successful"
```

### Restart service
```bash
sudo systemctl restart nanoclaw
```

### Check Telegram bot
```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe"
```

## 📞 Support

If you encounter issues:
1. Check the logs: `journalctl -u nanoclaw -f`
2. Verify Docker is running: `docker info`
3. Test Telegram bot token: Use the curl command above
4. Check SSH connection: `ssh -i ~/.ssh/nanoclaw_unraid adam@192.168.12.153`

## 🔒 Security Reminder

**After setup is complete, regenerate your Telegram bot token:**

1. Message @BotFather
2. Send `/revoke`
3. Select your bot
4. Then send `/token` to get a new token
5. Update `.env` with the new token
6. Restart: `sudo systemctl restart nanoclaw`
