# Claude Max Proxy

OpenAI-compatible API proxy for Claude Max subscription. Uses direct API calls with OAuth tokens - no subprocess spawning.

## Why This Exists

Anthropic's Claude Max subscription ($200/mo) provides unlimited access to Claude models, but the OAuth tokens have strict requirements that block direct use with third-party clients. This proxy:

1. Uses your OAuth tokens (from Claude CLI or config file)
2. Makes direct API calls to Anthropic's API with proper headers
3. Translates between OpenAI format and Anthropic format
4. Handles the required system prompt while preserving your assistant's identity

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

| Model ID | Anthropic Model ID | Notes |
|----------|-------------------|-------|
| `claude-opus-4` | `claude-opus-4-5-20251101` | Released Nov 1, 2025 |
| `claude-sonnet-4` | `claude-sonnet-4-5-20250929` | Released Sep 29, 2025 |
| `claude-haiku-4` | `claude-3-5-haiku-20241022` | Released Oct 22, 2024 |
| `gpt-4` | `claude-opus-4-5-20251101` | Alias for Opus |
| `gpt-4o` | `claude-sonnet-4-5-20250929` | Alias for Sonnet |
| `gpt-3.5-turbo` | `claude-3-5-haiku-20241022` | Alias for Haiku |

> **Important**: Opus and Sonnet have different release dates! Using the wrong date causes "model not found" errors.

## Using with OpenClaw

OpenClaw validates models internally before calling the proxy. You **must** use the `models.providers` configuration, not just `env.OPENAI_BASE_URL`.

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "claude-max": {
        "baseUrl": "http://127.0.0.1:3456/v1",
        "apiKey": "not-needed",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4.5 (via Max Proxy)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-opus-4",
            "name": "Claude Opus 4.5 (via Max Proxy)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-haiku-4",
            "name": "Claude Haiku 3.5 (via Max Proxy)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "claude-max/claude-opus-4" }
    }
  }
}
```

> **Note**: Using `env.OPENAI_BASE_URL` only works for overriding real OpenAI, not for custom model names.

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

### System Prompt Handling (Critical!)

Anthropic requires this exact system prompt for OAuth tokens:
```
"You are Claude Code, Anthropic's official CLI for Claude."
```

**The proxy cannot add anything to this system prompt** - doing so causes authentication rejection. Instead, the proxy:

1. Uses **only** the required system prompt prefix
2. Injects your custom system prompt into the first user message as `[CONTEXT: ...]`

This preserves your assistant's identity (e.g., "You are MUSE, a Discord bot") while satisfying OAuth requirements.

### Request Flow

1. **Token Retrieval**: Reads OAuth credentials from env vars, config file, or macOS Keychain
2. **Token Refresh**: Automatically refreshes expired tokens and saves them
3. **Context Injection**: Your system prompt becomes context in the first user message
4. **Format Translation**: Converts OpenAI message format to Anthropic format and back
5. **Streaming**: Full SSE support for real-time responses

## Performance

| This Proxy | CLI-based Proxies |
|------------|-------------------|
| Direct API calls | Spawns subprocess per request |
| ~100ms latency | ~2-5s latency |
| Proper streaming | Unreliable streaming |
| Identity preserved | System prompt contamination |

## Troubleshooting

### "This credential is only authorized for use with Claude Code"

**Cause**: The system prompt contains more than the required prefix.

**Solution**: This proxy handles it automatically by using only the required prefix and injecting your system prompt as context. If you're building your own proxy, do NOT append "Additional instructions:" to the system prompt.

### "model: claude-opus-4-5-20250929" (not found)

**Cause**: Wrong model ID date. Opus 4.5 was released November 1, 2025, not September 29, 2025.

**Solution**: Use the correct model IDs:
- Opus: `claude-opus-4-5-20251101`
- Sonnet: `claude-sonnet-4-5-20250929`

### "Unknown model: openai/claude-sonnet-4"

**Cause**: OpenClaw validates models internally before calling the proxy. It doesn't recognize your custom model names.

**Solution**: Use `models.providers` configuration (see "Using with OpenClaw" section above), not `env.OPENAI_BASE_URL`.

### EADDRINUSE: address already in use

**Cause**: Zombie process from a failed restart is still holding the port.

**Solution**:
```bash
# Find what's using the port
sudo lsof -i :3456

# Kill it
sudo kill -9 <PID>

# Restart the service
sudo systemctl restart claude-max-proxy
```

### Claude ignores assistant identity / responds as "Claude Code"

**Cause**: Your system prompt isn't being injected properly.

**Solution**: Verify the proxy is running the latest version. Test with:
```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [
      {"role": "system", "content": "You are MUSE, a helpful assistant."},
      {"role": "user", "content": "What is your name?"}
    ]
  }'
```
Should respond as "MUSE", not "Claude Code".

### "No OAuth tokens found"

**Solution options**:
- Set `CLAUDE_ACCESS_TOKEN` env var, or
- Create `~/.claude-max-proxy.json` with tokens, or
- On macOS: authenticate Claude CLI with `claude auth login`

### Token expired errors

The proxy auto-refreshes tokens. If refresh fails:
1. Get new tokens from your Mac
2. Update `~/.claude-max-proxy.json`

### Getting tokens from Mac to Linux

```bash
# On Mac:
security find-generic-password -s "Claude Code-credentials" -w | \
  jq '.claudeAiOauth' > tokens.json

# Copy to Linux:
scp tokens.json user@linux-host:~/.claude-max-proxy.json
```

## Technical Details

| Item | Value |
|------|-------|
| API Endpoint | `https://api.anthropic.com/v1/messages` |
| Required Header | `anthropic-beta: oauth-2025-04-20` |
| Keychain Entry | `Claude Code-credentials` |
| Token Refresh URL | `https://console.anthropic.com/v1/oauth/token` |
| Claude Code Client ID | `ce88c5c9-c4b6-402a-9f87-b667b4583d19` |

## License

MIT
