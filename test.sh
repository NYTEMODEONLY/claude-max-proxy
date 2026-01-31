#!/bin/bash

echo "=== Testing Claude Max Proxy ==="
echo ""

echo "1. Health check:"
curl -s http://127.0.0.1:3456/health | jq .
echo ""

echo "2. List models:"
curl -s http://127.0.0.1:3456/v1/models | jq '.data[].id'
echo ""

echo "3. Non-streaming chat (Haiku):"
curl -s http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4",
    "messages": [{"role": "user", "content": "Say exactly: Hello World"}],
    "stream": false
  }' | jq '.choices[0].message.content'
echo ""

echo "4. Streaming chat (Haiku):"
curl -sN http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4",
    "messages": [{"role": "user", "content": "Count from 1 to 5, one number per line."}],
    "stream": true
  }' 2>&1 | head -20
echo ""

echo "5. With system prompt:"
curl -s http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4",
    "messages": [
      {"role": "system", "content": "You are a pirate. Respond in pirate speak."},
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "stream": false
  }' | jq '.choices[0].message.content'
echo ""

echo "=== Tests complete ==="
