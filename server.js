#!/usr/bin/env node

/**
 * Claude Max Proxy v3.3.0 - XML Filtered + Empty Message Fix
 */

import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

const MODEL_MAP = {
  'claude-opus-4': 'claude-opus-4-5-20251101',
  'claude-sonnet-4': 'claude-sonnet-4-5-20250929',
  'claude-haiku-4': 'claude-3-5-haiku-20241022',
  'opus': 'claude-opus-4-5-20251101',
  'sonnet': 'claude-sonnet-4-5-20250929',
  'haiku': 'claude-3-5-haiku-20241022',
  'gpt-4': 'claude-opus-4-5-20251101',
  'gpt-4o': 'claude-sonnet-4-5-20250929',
  'gpt-3.5-turbo': 'claude-3-5-haiku-20241022',
  'openai/claude-opus-4': 'claude-opus-4-5-20251101',
  'openai/claude-sonnet-4': 'claude-sonnet-4-5-20250929',
  'openai/claude-haiku-4': 'claude-3-5-haiku-20241022',
};

const AVAILABLE_MODELS = [
  { id: 'claude-opus-4', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4', name: 'Claude Haiku 3.5' },
];

const CONFIG_FILE = join(homedir(), '.claude-max-proxy.json');

let cachedTokens = null;
let tokenExpiry = 0;

function loadTokensFromEnv() {
  const accessToken = process.env.CLAUDE_ACCESS_TOKEN;
  if (accessToken) return { accessToken, expiresAt: Date.now() + 86400000 };
  return null;
}

function loadTokensFromFile() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      if (data.accessToken) return data;
    }
  } catch (e) {}
  return null;
}

function loadTokensFromKeychain() {
  if (process.platform !== 'darwin') return null;
  try {
    const output = execSync('security find-generic-password -s "Claude Code-credentials" -w', { encoding: 'utf8', timeout: 5000 }).trim();
    return JSON.parse(output).claudeAiOauth;
  } catch (e) { return null; }
}

function saveTokensToFile(tokens) {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 }); } catch (e) {}
}

async function getOAuthTokens() {
  if (cachedTokens && Date.now() < tokenExpiry - 300000) return cachedTokens;
  let oauth = loadTokensFromEnv() || loadTokensFromFile() || loadTokensFromKeychain();
  if (!oauth?.accessToken) throw new Error('No OAuth tokens found.');
  if (oauth.expiresAt && Date.now() >= oauth.expiresAt - 300000 && oauth.refreshToken) {
    const refreshed = await doRefreshToken(oauth.refreshToken);
    if (refreshed) { saveTokensToFile(refreshed); cachedTokens = refreshed; tokenExpiry = refreshed.expiresAt; return refreshed; }
  }
  cachedTokens = oauth;
  tokenExpiry = oauth.expiresAt || Date.now() + 3600000;
  return oauth;
}

async function doRefreshToken(refreshTok) {
  try {
    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshTok, client_id: 'ce88c5c9-c4b6-402a-9f87-b667b4583d19' }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshTok, expiresAt: Date.now() + (data.expires_in * 1000) };
  } catch (e) { return null; }
}

function buildToolContext(tools, systemPrompts) {
  let context = '';
  if (systemPrompts && systemPrompts.length > 0) {
    context += '[Assistant Identity]\n' + systemPrompts.join('\n') + '\n\n';
  }
  if (tools && tools.length > 0) {
    const defs = tools.map(t => {
      const fn = t.function || t;
      return `- ${fn.name}: ${fn.description || 'No description'}`;
    }).join('\n');
    context += '[Available Tools]\n' + defs + '\n\n[Tool Usage]\nWhen you need to use a tool, output XML:\n<function_calls>\n<invoke name="TOOL_NAME">\n<parameter name="PARAM">VALUE</parameter>\n</invoke>\n</function_calls>\nDo NOT show the XML to the user or explain it. Just use it silently.\n\n';
  }
  return context;
}

function parseXmlToolCalls(text) {
  const toolCalls = [];
  const regex = /<function_calls>([\s\S]*?)<\/function_calls>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    let invokeMatch;
    while ((invokeMatch = invokeRegex.exec(match[1])) !== null) {
      const params = {};
      const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(invokeMatch[2])) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
      toolCalls.push({
        id: 'call_' + randomUUID().split('-')[0],
        type: 'function',
        function: { name: invokeMatch[1], arguments: JSON.stringify(params) }
      });
    }
  }
  const cleanText = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '').trim();
  return { toolCalls, cleanText };
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return content?.text || '';
}

function convertMessages(messages, tools) {
  let systemPrompts = [];
  const anthropicMessages = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompts.push(extractText(msg.content));
    } else if (msg.role === 'user') {
      const content = extractText(msg.content);
      if (content) {
        anthropicMessages.push({ role: 'user', content });
      }
    } else if (msg.role === 'assistant') {
      let content = extractText(msg.content);
      // If assistant message has tool_calls but no content, add placeholder
      if ((!content || content.trim() === '') && msg.tool_calls && msg.tool_calls.length > 0) {
        content = '[Using tools...]';
      }
      // Skip completely empty assistant messages (shouldn't happen, but safety)
      if (content && content.trim()) {
        anthropicMessages.push({ role: 'assistant', content });
      }
    } else if (msg.role === 'tool') {
      const content = `[Tool Result: ${msg.tool_call_id}]\n${extractText(msg.content)}`;
      anthropicMessages.push({ role: 'user', content });
    }
  }
  
  // Ensure we don't have consecutive same-role messages (merge or fix)
  const fixedMessages = [];
  for (const msg of anthropicMessages) {
    if (fixedMessages.length > 0 && fixedMessages[fixedMessages.length - 1].role === msg.role) {
      // Merge consecutive same-role messages
      fixedMessages[fixedMessages.length - 1].content += '\n\n' + msg.content;
    } else {
      fixedMessages.push(msg);
    }
  }
  
  // Inject tool context into first user message
  const toolContext = buildToolContext(tools, systemPrompts);
  if (toolContext && fixedMessages.length > 0) {
    for (let i = 0; i < fixedMessages.length; i++) {
      if (fixedMessages[i].role === 'user') {
        fixedMessages[i].content = toolContext + '[User Message]\n' + fixedMessages[i].content;
        break;
      }
    }
  }
  
  return { system: CLAUDE_CODE_SYSTEM, messages: fixedMessages };
}

async function handleChat(req, res, body) {
  const { model, messages, temperature, max_tokens, tools, stream } = body;
  const mappedModel = MODEL_MAP[model] || MODEL_MAP['claude-sonnet-4'];
  const { system, messages: anthropicMessages } = convertMessages(messages, tools);
  const hasTools = tools && tools.length > 0;

  console.log(`[${stream ? 'STREAM' : 'SYNC'}] model=${mappedModel}, tools=${tools?.length || 0}, msgs=${anthropicMessages.length}`);

  const requestId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  let tokens;
  try { tokens = await getOAuthTokens(); }
  catch (e) { return sendJSON(res, 401, { error: { message: e.message } }); }

  const requestBody = {
    model: mappedModel,
    system: system,
    messages: anthropicMessages,
    max_tokens: max_tokens || 8192,
  };
  if (temperature !== undefined) requestBody.temperature = temperature;

  // For tool requests, use sync to ensure XML is filtered before sending
  if (stream && !hasTools) {
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
        body: JSON.stringify({ ...requestBody, stream: true }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('API error:', response.status, error);
        res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
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
              res.write(`data: ${JSON.stringify({
                id: requestId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }]
              })}\n\n`);
            } else if (event.type === 'message_stop') {
              res.write(`data: ${JSON.stringify({
                id: requestId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
              })}\n\n`);
            }
          } catch (e) {}
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
  } else {
    // Sync mode for tool requests
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('API error:', response.status, error);
        return sendJSON(res, response.status, { error: { message: error } });
      }

      const data = await response.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const { toolCalls, cleanText } = parseXmlToolCalls(text);

      // Ensure we always have some content for the response
      const finalContent = cleanText || (toolCalls.length > 0 ? null : 'Done.');
      
      const message = { role: 'assistant', content: finalContent };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        
        if (finalContent) {
          res.write(`data: ${JSON.stringify({
            id: requestId, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { content: finalContent }, finish_reason: null }]
          })}\n\n`);
        }
        
        if (toolCalls.length > 0) {
          res.write(`data: ${JSON.stringify({
            id: requestId, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }]
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            id: requestId, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          })}\n\n`);
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        sendJSON(res, 200, {
          id: requestId, object: 'chat.completion', created, model,
          choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: data.usage?.input_tokens || -1, completion_tokens: data.usage?.output_tokens || -1, total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) },
        });
      }
    } catch (e) {
      console.error('Error:', e);
      sendJSON(res, 500, { error: { message: e.message } });
    }
  }
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    return res.end();
  }

  if (path === '/health' || path === '/') {
    try {
      await getOAuthTokens();
      return sendJSON(res, 200, { status: 'ok', version: '3.3.0', mode: 'xml-filtered', features: ['oauth', 'tools', 'empty-msg-fix'] });
    } catch (e) {
      return sendJSON(res, 200, { status: 'error', version: '3.3.0', error: e.message });
    }
  }

  if (path === '/v1/models' && method === 'GET') {
    return sendJSON(res, 200, { object: 'list', data: AVAILABLE_MODELS.map(m => ({ id: m.id, object: 'model', created: 1700000000, owned_by: 'anthropic' })) });
  }

  if (path === '/v1/chat/completions' && method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.messages) return sendJSON(res, 400, { error: { message: 'messages required' } });
      return handleChat(req, res, body);
    } catch (e) {
      return sendJSON(res, 500, { error: { message: e.message } });
    }
  }

  sendJSON(res, 404, { error: { message: 'Not found' } });
}

const server = createServer(handleRequest);
server.listen(PORT, HOST, async () => {
  let status = 'checking...';
  try { await getOAuthTokens(); status = 'valid'; } catch (e) { status = e.message; }
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║     Claude Max Proxy v3.3.0 (Empty Message Fix)               ║
╠═══════════════════════════════════════════════════════════════╣
║  Server: http://${HOST}:${PORT}                                   ║
║  Token:  ${status.padEnd(45)}║
║  Fix:    Handles empty assistant messages from tool calls     ║
╚═══════════════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
