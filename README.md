# Claude Max Proxy v3.3.0

OpenAI-compatible API proxy for Claude Max subscription with **full tool support**. Uses OAuth tokens with XML-based tool calling - the same method Claude Code uses internally.

## What's New in v3.3.0

- **Full Tool Support**: Works with OpenClaw, Cursor, and any OpenAI-compatible client
- **XML Tool Parsing**: Converts Claude's XML function calls to OpenAI tool_calls format
- **Clean Output**: No XML visible in chat - tool calls are parsed and stripped
- **Multi-turn Conversations**: Handles tool results and conversation history correctly

## Why This Exists

Claude Max OAuth tokens have restrictions:
1. Cannot use the API `tools` parameter directly
2. Must use exact Claude Code system prompt

This proxy works around these limitations by:
1. Injecting tool definitions into the user message (not system prompt)
2. Parsing Claude's XML tool calls from the response
3. Converting to OpenAI tool_calls format for your client

## Requirements

- **Node.js 20+**
- **Claude Max subscription** with OAuth tokens

## Quick Start

### macOS (automatic)

```bash
node server.js
```

Reads tokens from macOS Keychain automatically.

### Linux / Raspberry Pi

Create a config file:

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

### Getting Your Tokens

On a Mac with Claude CLI authenticated:

```bash
security find-generic-password -s "Claude Code-credentials" -w | jq '.claudeAiOauth'
```

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:3456/health
# {"status":"ok","version":"3.3.0","mode":"xml-filtered","features":["oauth","tools","empty-msg-fix"]}
```

### Chat Completions with Tools
```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-opus-4", "messages": [{"role": "user", "content": "Write hello to test.txt"}], "tools": [{"type": "function", "function": {"name": "write_file", "description": "Write content to a file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}}}}]}'
```

Response:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "write_file",
          "arguments": "{\"path\":\"test.txt\",\"content\":\"hello\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

## Available Models

| Model ID | Maps To |
|----------|---------|
| `claude-opus-4` | Claude Opus 4.5 (claude-opus-4-5-20251101) |
| `claude-sonnet-4` | Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) |
| `claude-haiku-4` | Claude Haiku 3.5 (claude-3-5-haiku-20241022) |
| `gpt-4` | Claude Opus 4.5 |
| `gpt-4o` | Claude Sonnet 4.5 |

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

## How It Works

```
OpenClaw (OpenAI format) → Proxy → Anthropic API (OAuth)
         ↑                              ↓
         └── Parse XML, convert to tool_calls ←┘
```

1. **Receives** OpenAI-format request with tools
2. **Injects** tool definitions into first user message
3. **Sends** to Anthropic API (no tools param, OAuth compatible)
4. **Parses** XML `<function_calls>` from Claude's response
5. **Converts** to OpenAI `tool_calls` format
6. **Returns** clean response with no XML visible

## Running as a Service

### systemd (User Service)

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/claude-max-proxy.service << 'EOF'
[Unit]
Description=Claude Max Proxy v3.3 - OAuth + Tools
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/claude-max-proxy/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable claude-max-proxy
systemctl --user start claude-max-proxy
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "credential only authorized for Claude Code" | Used API tools param | Use this proxy - it handles tool conversion |
| "messages.N: non-empty content" | Empty message from tool-only response | v3.3 adds placeholder content automatically |
| XML visible in chat | Old version or wrong mode | Update to v3.3, uses sync for tool requests |

## Version History

- **v3.3.0** - Empty message fix, consecutive message merging, full tool support
- **v3.2.0** - Stream filtering for tool requests  
- **v3.1.0** - Tool injection via user message (OAuth compatible)
- **v3.0.0** - XML tool parsing
- **v2.0.0** - Extended thinking support
- **v1.0.0** - Direct API calls (original)

## Credits

A [NYTEMODE](https://github.com/NYTEMODEONLY) project.

Based on [claude-code-proxy](https://github.com/fuergaosi233/claude-code-proxy) concept, rebuilt with full tool support via XML parsing.

## License

MIT
