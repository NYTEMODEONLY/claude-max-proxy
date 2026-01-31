#!/usr/bin/env node

/**
 * Claude Max Proxy v2 - Direct API approach
 *
 * Uses OAuth tokens from Claude CLI to call Anthropic API directly.
 * No subprocess spawning = fast and reliable.
 */

import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Required system prompt prefix for OAuth tokens
const REQUIRED_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

// Model mapping
const MODEL_MAP = {
  'claude-opus-4': 'claude-opus-4-5-20250929',
  'claude-opus-4.5': 'claude-opus-4-5-20250929',
  'claude-sonnet-4': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'claude-haiku-4': 'claude-3-5-haiku-20241022',
  'opus': 'claude-opus-4-5-20250929',
  'sonnet': 'claude-sonnet-4-5-20250929',
  'haiku': 'claude-3-5-haiku-20241022',
  'gpt-4': 'claude-opus-4-5-20250929',
  'gpt-4o': 'claude-sonnet-4-5-20250929',
  'gpt-3.5-turbo': 'claude-3-5-haiku-20241022',
};

const AVAILABLE_MODELS = [
  { id: 'claude-opus-4', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4', name: 'Claude Haiku 3.5' },
];

/**
 * Token management
 */
let cachedTokens = null;
let tokenExpiry = 0;

async function getOAuthTokens() {
  // Check if cached token is still valid (with 5 min buffer)
  if (cachedTokens && Date.now() < tokenExpiry - 300000) {
    return cachedTokens;
  }

  try {
    // Read from macOS Keychain
    const output = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    const creds = JSON.parse(output);
    const oauth = creds.claudeAiOauth;

    if (!oauth?.accessToken) {
      throw new Error('No access token found in credentials');
    }

    // Check if token is expired and needs refresh
    if (oauth.expiresAt && Date.now() >= oauth.expiresAt - 300000) {
      console.log('Token expired, attempting refresh...');
      const refreshed = await refreshToken(oauth.refreshToken);
      if (refreshed) {
        cachedTokens = refreshed;
        tokenExpiry = refreshed.expiresAt;
        return refreshed;
      }
    }

    cachedTokens = oauth;
    tokenExpiry = oauth.expiresAt || Date.now() + 3600000;
    return oauth;
  } catch (e) {
    console.error('Failed to get OAuth tokens:', e.message);
    throw new Error('Could not retrieve OAuth tokens. Make sure Claude CLI is authenticated.');
  }
}

async function refreshToken(refreshToken) {
  try {
    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'ce88c5c9-c4b6-402a-9f87-b667b4583d19', // Claude Code client ID
      }),
    });

    if (!response.ok) {
      console.error('Token refresh failed:', response.status);
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
  } catch (e) {
    console.error('Token refresh error:', e.message);
    return null;
  }
}

/**
 * Convert OpenAI messages to Anthropic format
 */
function convertMessages(messages) {
  let systemPrompts = [];
  const anthropicMessages = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content?.map(c => c.text || '').join('\n') || '';

    if (msg.role === 'system') {
      systemPrompts.push(content);
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      anthropicMessages.push({
        role: msg.role,
        content: content,
      });
    }
  }

  // Build system prompt: required prefix + user's system prompt
  let finalSystem = REQUIRED_SYSTEM_PREFIX;
  if (systemPrompts.length > 0) {
    // Add user's system prompt as additional context
    finalSystem += '\n\nAdditional instructions:\n' + systemPrompts.join('\n\n');
  }

  return { system: finalSystem, messages: anthropicMessages };
}

/**
 * Handle streaming chat completion
 */
async function handleChatCompletionStream(req, res, body) {
  const { model, messages, temperature, max_tokens } = body;
  const mappedModel = MODEL_MAP[model] || MODEL_MAP['claude-sonnet-4'];
  const { system, messages: anthropicMessages } = convertMessages(messages);

  const requestId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  console.log(`[${new Date().toISOString()}] Stream: model=${mappedModel}`);

  let tokens;
  try {
    tokens = await getOAuthTokens();
  } catch (e) {
    return sendJSON(res, 401, { error: { message: e.message } });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: mappedModel,
        system: system,
        messages: anthropicMessages,
        max_tokens: max_tokens || 4096,
        temperature: temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', response.status, error);
      res.write(`data: ${JSON.stringify({ error: { message: error, status: response.status } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_delta' && event.delta?.text) {
            const sseData = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: model,
              choices: [{
                index: 0,
                delta: { content: event.delta.text },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(sseData)}\n\n`);
          } else if (event.type === 'message_stop') {
            const sseData = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
            };
            res.write(`data: ${JSON.stringify(sseData)}\n\n`);
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('Stream error:', e);
    res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * Handle non-streaming chat completion
 */
async function handleChatCompletionSync(req, res, body) {
  const { model, messages, temperature, max_tokens } = body;
  const mappedModel = MODEL_MAP[model] || MODEL_MAP['claude-sonnet-4'];
  const { system, messages: anthropicMessages } = convertMessages(messages);

  const requestId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  console.log(`[${new Date().toISOString()}] Sync: model=${mappedModel}`);

  let tokens;
  try {
    tokens = await getOAuthTokens();
  } catch (e) {
    return sendJSON(res, 401, { error: { message: e.message } });
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: mappedModel,
        system: system,
        messages: anthropicMessages,
        max_tokens: max_tokens || 4096,
        temperature: temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', response.status, error);
      return sendJSON(res, response.status, { error: { message: error } });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    const result = {
      id: requestId,
      object: 'chat.completion',
      created,
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content,
        },
        finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || -1,
        completion_tokens: data.usage?.output_tokens || -1,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };

    sendJSON(res, 200, result);
  } catch (e) {
    console.error('Request error:', e);
    sendJSON(res, 500, { error: { message: e.message } });
  }
}

/**
 * Send JSON response
 */
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * Parse request body
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // Health check
  if (path === '/health' || path === '/') {
    // Test token access
    try {
      const tokens = await getOAuthTokens();
      return sendJSON(res, 200, {
        status: 'ok',
        version: '2.0.0',
        subscription: tokens.subscriptionType || 'unknown',
        tokenValid: tokens.expiresAt > Date.now(),
      });
    } catch (e) {
      return sendJSON(res, 200, {
        status: 'error',
        version: '2.0.0',
        error: e.message,
      });
    }
  }

  // List models
  if (path === '/v1/models' && method === 'GET') {
    return sendJSON(res, 200, {
      object: 'list',
      data: AVAILABLE_MODELS.map(m => ({
        id: m.id,
        object: 'model',
        created: 1700000000,
        owned_by: 'anthropic',
      })),
    });
  }

  // Chat completions
  if (path === '/v1/chat/completions' && method === 'POST') {
    try {
      const body = await parseBody(req);

      if (!body.messages || !Array.isArray(body.messages)) {
        return sendJSON(res, 400, { error: { message: 'messages array required' } });
      }

      if (body.stream === true) {
        return handleChatCompletionStream(req, res, body);
      } else {
        return handleChatCompletionSync(req, res, body);
      }
    } catch (e) {
      console.error('Request error:', e);
      return sendJSON(res, 500, { error: { message: e.message } });
    }
  }

  // 404 for unknown routes
  sendJSON(res, 404, { error: { message: 'Not found' } });
}

// Create and start server
const server = createServer(handleRequest);

server.listen(PORT, HOST, async () => {
  let tokenStatus = 'checking...';
  try {
    const tokens = await getOAuthTokens();
    tokenStatus = `valid (${tokens.subscriptionType || 'unknown'})`;
  } catch (e) {
    tokenStatus = `error: ${e.message}`;
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Claude Max Proxy v2.0.0 (Direct API)                ║
╠═══════════════════════════════════════════════════════════════╣
║  Server: http://${HOST}:${PORT}                                   ║
║  Token:  ${tokenStatus.padEnd(45)}║
║                                                               ║
║  Endpoints:                                                   ║
║    GET  /health              - Health check + token status    ║
║    GET  /v1/models           - List models                    ║
║    POST /v1/chat/completions - Chat (streaming/sync)          ║
║                                                               ║
║  Models: claude-opus-4, claude-sonnet-4, claude-haiku-4       ║
╚═══════════════════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
