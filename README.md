# Claude Max Proxy v3.4.0

**The only working proxy that enables Claude Max subscriptions to work with full tool support in OpenAI-compatible clients.**

Uses OAuth tokens with XML-based tool calling and history reconstruction - the same method Claude Code uses internally.

## What's New in v3.4.0

- **XML History Reconstruction**: Fixes the "[Using tools...]" infinite loop by converting tool_calls back to XML format in conversation history
- **Full Tool Support**: Works with OpenClaw, Cursor, and any OpenAI-compatible client
- **XML Tool Parsing**: Converts Claude's XML function calls to OpenAI tool_calls format
- **Clean Output**: No XML visible in chat - tool calls are parsed and stripped
- **Multi-turn Conversations**: Properly handles tool results and maintains conversation context

## Why This Exists

Claude Max OAuth tokens have restrictions that prevent direct API tool usage:

1. OAuth tokens are **restricted to Claude Code CLI only**
2. Cannot use the API `tools` parameter directly
3. Must use exact Claude Code system prompt

This proxy works around these limitations by:

1. Using the magic system prompt: `"You are Claude Code, Anthropic's official CLI for Claude."`
2. Using the beta header: `anthropic-beta: oauth-2025-04-20`
3. Injecting tool definitions into user messages (not system prompt)
4. Parsing Claude's XML tool calls and converting to OpenAI format
5. **Reconstructing tool call history back to XML** so Claude recognizes its own previous actions

## Key Innovation

Most Claude Max proxies fail because:
- They use subprocess calls to Claude Code CLI (slow/unreliable)
- They don't handle tool calls properly
- They get stuck in "[Using tools...]" loops

This proxy solves all these issues with direct API calls and proper history reconstruction.

## Requirements

- **Node.js 20+**
- **Claude Max subscription** with OAuth tokens

## Quick Start

### macOS (automatic)

```bash
git clone https://github.com/NYTEMODEONLY/claude-max-proxy
cd claude-max-proxy
node server.js
```

Reads tokens from macOS Keychain automatically.

### Linux / Raspberry Pi

Create a config file with your OAuth tokens:

```bash
cat > ~/.claude-max-proxy.json << 'EOF'
{
  "accessToken": "sk-ant-oat01-YOUR_ACCESS_TOKEN",
  "refreshToken": "sk-ant-ort01-YOUR_REFRESH_TOKEN",
  "expiresAt": 1801509282451
}
EOF
chmod 600 ~/.claude-max-proxy.json

node server.js
```

### Getting Your Tokens

On a Mac with Claude CLI authenticated:

```bash
security find-generic-password -s "Claude Code-credentials" -w | jq '.claudeAiOauth'
```

Or extract from Claude Code's storage on any platform where you're logged in.

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:3456/health
# {"status":"ok","version":"3.4.0","mode":"xml-history-reconstruction","features":["oauth","tools","xml-history"]}
```

### List Models
```bash
curl http://127.0.0.1:3456/v1/models
```

### Chat Completions with Tools
```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [{"role": "user", "content": "Check the weather in Tokyo"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    }]
  }'
```

Response:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "I'll check the weather in Tokyo for you.",
      "tool_calls": [{
        "id": "call_069804ba",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\":\"Tokyo\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

## Available Models

| Model ID | Maps To | Description |
|----------|---------|-------------|
| `claude-opus-4` | claude-opus-4-5-20251101 | Most capable, best for complex tasks |
| `claude-sonnet-4` | claude-sonnet-4-5-20250929 | Balanced performance and speed |
| `claude-haiku-4` | claude-3-5-haiku-20241022 | Fastest, best for simple tasks |
| `gpt-4` | claude-opus-4-5-20251101 | OpenAI compatibility alias |
| `gpt-4o` | claude-sonnet-4-5-20250929 | OpenAI compatibility alias |
| `gpt-3.5-turbo` | claude-3-5-haiku-20241022 | OpenAI compatibility alias |

## Using with OpenClaw

Add to `~/.openclaw/openclaw.json`:

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
            "id": "claude-opus-4",
            "name": "Claude Opus 4.5 (via Max Proxy)",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0},
            "contextWindow": 200000,
            "maxTokens": 65536
          },
          {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4.5 (via Max Proxy)",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0},
            "contextWindow": 200000,
            "maxTokens": 65536
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "claude-max/claude-opus-4" }
    }
  },
  "tools": {
    "profile": "full"
  }
}
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw / Cursor / Any OpenAI Client                      │
│  (sends OpenAI-format request with tools)                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Claude Max Proxy v3.4.0                                    │
│  1. Inject tool definitions into user message               │
│  2. Convert previous tool_calls back to XML (v3.4 fix!)     │
│  3. Use Claude Code system prompt + OAuth header            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Anthropic API (with OAuth token)                           │
│  Claude responds with XML <function_calls>                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Claude Max Proxy                                           │
│  1. Parse XML function_calls from response                  │
│  2. Strip XML from visible content                          │
│  3. Convert to OpenAI tool_calls format                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Client receives clean OpenAI-format response               │
│  with tool_calls array (no XML visible)                     │
└─────────────────────────────────────────────────────────────┘
```

## Running as a Service

### systemd (User Service)

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/claude-max-proxy.service << 'EOF'
[Unit]
Description=Claude Max Proxy v3.4.0 - OAuth + Full Tool Support
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/lobo/claude-max-proxy
ExecStart=/usr/bin/node /home/lobo/claude-max-proxy/server.js
Restart=on-failure
RestartSec=5
Environment=HOST=0.0.0.0

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable claude-max-proxy
systemctl --user start claude-max-proxy
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3456 | Server port |
| `HOST` | 127.0.0.1 | Bind address (use 0.0.0.0 for network access) |
| `CLAUDE_ACCESS_TOKEN` | - | Override OAuth token (optional) |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "credential only authorized for Claude Code" | Direct API tool usage attempted | Use this proxy - it handles OAuth restrictions |
| "[Using tools...]" loop | Tool history not reconstructed | Update to v3.4.0 - fixes this with XML history |
| "messages.N: non-empty content" | Empty message from tool-only response | v3.3+ adds placeholder content automatically |
| XML visible in chat | Old version | Update to v3.3+ - uses sync mode for tool requests |
| Token expired | OAuth token needs refresh | Re-extract tokens from Claude Code |

## Version History

- **v3.4.0** - XML History Reconstruction (fixes "[Using tools...]" loop)
- **v3.3.0** - Empty message fix, consecutive message merging, full tool support
- **v3.2.0** - Stream filtering for tool requests  
- **v3.1.0** - Tool injection via user message (OAuth compatible)
- **v3.0.0** - XML tool parsing
- **v2.0.0** - Extended thinking support
- **v1.0.0** - Direct API calls (original)

## Comparison with Other Solutions

| Feature | Claude Max Proxy | CLI Subprocess Proxies | API Key Solutions |
|---------|-----------------|----------------------|-------------------|
| Auth Method | OAuth (free with Max) | OAuth | API Key ($$$) |
| Tool Support | ✅ Full | ⚠️ Limited | ✅ Full |
| Speed | ✅ Fast (direct API) | ❌ Slow (subprocess) | ✅ Fast |
| History Handling | ✅ Reconstructs XML | ❌ Often breaks | ✅ Native |
| Multi-turn Tools | ✅ Works | ❌ Often loops | ✅ Works |

## Credits

A [NYTEMODE](https://github.com/NYTEMODEONLY) project.

Built for use with [OpenClaw](https://github.com/openclaw) and other OpenAI-compatible tools.

## License

MIT
