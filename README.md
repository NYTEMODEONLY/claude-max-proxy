# Claude Max Proxy

OpenAI-compatible API proxy for Claude Max subscription. Uses direct API calls with OAuth tokens from Claude CLI - no subprocess spawning.

## Why This Exists

Anthropic blocks OAuth tokens from being used directly with third-party API clients. This proxy:

1. Reads your OAuth tokens from the macOS Keychain (stored by Claude CLI)
2. Makes direct API calls to Anthropic's API
3. Translates between OpenAI format and Anthropic format
4. Handles the required system prompt prefix transparently

## Requirements

- **Node.js 20+**
- **Claude CLI** installed and authenticated (`claude` command works)
- **macOS** (for Keychain access - Linux support coming)

## Quick Start

```bash
# Start the proxy
node server.js

# Or with npm
npm start
```

The server runs at `http://127.0.0.1:3456` by default.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `127.0.0.1` | Bind address |

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

Add to your OpenClaw config:

```json5
{
  env: {
    OPENAI_API_KEY: "not-needed",
    OPENAI_BASE_URL: "http://127.0.0.1:3456/v1"
  },
  agents: {
    defaults: {
      model: { primary: "openai/claude-sonnet-4" }
    }
  }
}
```

## How It Works

1. **Token Retrieval**: Reads OAuth credentials from macOS Keychain entry "Claude Code-credentials"
2. **Token Refresh**: Automatically refreshes expired tokens using Anthropic's OAuth endpoint
3. **System Prompt**: Prepends the required "You are Claude Code..." prefix, then appends your system prompt as "Additional instructions"
4. **Format Translation**: Converts OpenAI message format to Anthropic format and back

## Differences from CLI-based Proxies

| This Proxy | CLI-based Proxies |
|------------|-------------------|
| Direct API calls | Spawns subprocess per request |
| ~100ms latency | ~2-5s latency |
| Proper streaming | Unreliable streaming |
| Clean context | System prompt contamination |

## Troubleshooting

**"Could not retrieve OAuth tokens"**
- Make sure Claude CLI is installed: `claude --version`
- Make sure you're logged in: `claude doctor`

**Token expired errors**
- The proxy auto-refreshes tokens, but if it fails, re-authenticate: `claude auth login`

## License

MIT
