# Claude Max Proxy

OpenAI-compatible API proxy for Claude Max subscription. Uses direct API calls with OAuth tokens - no subprocess spawning.

## Why This Exists

Anthropic blocks OAuth tokens from being used directly with third-party API clients. This proxy:

1. Uses your OAuth tokens (from Claude CLI or config file)
2. Makes direct API calls to Anthropic's API
3. Translates between OpenAI format and Anthropic format
4. Handles the required system prompt prefix transparently

## Requirements

- **Node.js 20+**
- **Claude Max subscription** with OAuth tokens

## Quick Start

### macOS (automatic)

If you have Claude CLI authenticated, just run:

```bash
node server.js
```

It reads tokens from macOS Keychain automatically.

### Linux / Raspberry Pi

Create a config file with your tokens:

```bash
cat > ~/.claude-max-proxy.json << 'EOF'
{
  "accessToken": "sk-ant-oat01-YOUR_ACCESS_TOKEN",
  "refreshToken": "sk-ant-ort01-YOUR_REFRESH_TOKEN",
  "expiresAt": 1769918712699
}
EOF
chmod 600 ~/.claude-max-proxy.json

node server.js
```

Or use environment variables:

```bash
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-YOUR_ACCESS_TOKEN"
export CLAUDE_REFRESH_TOKEN="sk-ant-ort01-YOUR_REFRESH_TOKEN"
node server.js
```

### Getting Your Tokens

On a Mac with Claude CLI authenticated:

```bash
security find-generic-password -s "Claude Code-credentials" -w | jq '.claudeAiOauth'
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `CLAUDE_ACCESS_TOKEN` | - | OAuth access token |
| `CLAUDE_REFRESH_TOKEN` | - | OAuth refresh token |
| `CLAUDE_TOKEN_EXPIRES` | - | Token expiry (Unix ms) |
| `CLAUDE_MAX_CONFIG` | `~/.claude-max-proxy.json` | Config file path |

Token sources (checked in order):
1. Environment variables
2. Config file (`~/.claude-max-proxy.json`)
3. macOS Keychain (macOS only)

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:3456/health
```

### List Models
```bash
curl http://127.0.0.1:3456/v1/models
```

### Chat Completions

**Non-streaming:**
```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Streaming:**
```bash
curl -N http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Available Models

| Model ID | Maps To |
|----------|---------|
| `claude-opus-4` | Claude Opus 4.5 |
| `claude-sonnet-4` | Claude Sonnet 4.5 |
| `claude-haiku-4` | Claude Haiku 3.5 |
| `gpt-4` | Claude Opus 4.5 |
| `gpt-4o` | Claude Sonnet 4.5 |
| `gpt-3.5-turbo` | Claude Haiku 3.5 |

## Using with OpenClaw

Add to your OpenClaw config (`~/.openclaw/config.json`):

```json
{
  "env": {
    "OPENAI_API_KEY": "not-needed",
    "OPENAI_BASE_URL": "http://127.0.0.1:3456/v1"
  },
  "agents": {
    "defaults": {
      "model": { "primary": "openai/claude-sonnet-4" }
    }
  }
}
```

## Running as a Service

### systemd (Linux/Raspberry Pi)

```bash
sudo tee /etc/systemd/system/claude-max-proxy.service << 'EOF'
[Unit]
Description=Claude Max Proxy
After=network.target

[Service]
Type=simple
User=lobo
WorkingDirectory=/home/lobo/claude-max-proxy
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=HOST=127.0.0.1
Environment=PORT=3456

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable claude-max-proxy
sudo systemctl start claude-max-proxy
```

### launchd (macOS)

```bash
cat > ~/Library/LaunchAgents/com.claude-max-proxy.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-max-proxy</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>/path/to/claude-max-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>server.js</string>
  </array>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.claude-max-proxy.plist
```

## How It Works

1. **Token Retrieval**: Reads OAuth credentials from env vars, config file, or macOS Keychain
2. **Token Refresh**: Automatically refreshes expired tokens and saves them
3. **System Prompt**: Prepends the required "You are Claude Code..." prefix, then appends your system prompt as "Additional instructions"
4. **Format Translation**: Converts OpenAI message format to Anthropic format and back

## Performance

| This Proxy | CLI-based Proxies |
|------------|-------------------|
| Direct API calls | Spawns subprocess per request |
| ~100ms latency | ~2-5s latency |
| Proper streaming | Unreliable streaming |
| Clean context | System prompt contamination |

## Troubleshooting

**"No OAuth tokens found"**
- Set `CLAUDE_ACCESS_TOKEN` env var, or
- Create `~/.claude-max-proxy.json` with tokens, or
- On macOS: authenticate Claude CLI with `claude auth login`

**Token expired errors**
- The proxy auto-refreshes tokens
- If refresh fails, get new tokens from your Mac

**Getting tokens from Mac to Linux**
```bash
# On Mac:
security find-generic-password -s "Claude Code-credentials" -w | \
  jq '.claudeAiOauth' > tokens.json

# Copy to Linux:
scp tokens.json user@linux-host:~/.claude-max-proxy.json
```

## License

MIT
