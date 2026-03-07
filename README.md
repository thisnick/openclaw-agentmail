# openclaw-agentmail-listener

An [OpenClaw](https://openclaw.ai) plugin that listens for incoming emails via [AgentMail](https://agentmail.to) WebSocket and injects system events so your AI agent can act on them.

## What it does

- Registers a background service at gateway startup
- Connects to AgentMail via raw WebSocket (`wss://ws.agentmail.to/v0`)
- Subscribes to a configured inbox (e.g. `nickbot@agentmail.to`)
- When a `message.received` event fires, injects a system event with email metadata (from, subject, preview)
- Wakes the agent immediately via `requestHeartbeatNow()` so emails are processed right away
- Auto-reconnects with exponential backoff on disconnect
- Keepalive pings every 30 seconds
- Stops cleanly when the gateway shuts down

This is **not** a channel plugin — it doesn't handle replies. It just triggers system events so the agent notices new emails and can decide what to do (e.g. read the full message via the AgentMail skill and reply).

## Installation

```bash
openclaw plugins install openclaw-agentmail-listener
```

Restart the gateway afterwards.

## Configuration

Add to your OpenClaw config under `plugins.entries`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-agentmail-listener": {
        "enabled": true,
        "config": {
          "apiKey": "am_us_your_key_here",
          "inboxId": "yourbot@agentmail.to"
        }
      }
    }
  }
}
```

### Config fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiKey` | string | ✅ | — | Your AgentMail API key |
| `inboxId` | string | ✅ | — | Inbox to subscribe (e.g. `nickbot@agentmail.to`) |
| `eventTypes` | string[] | — | `["message.received"]` | Event types to subscribe to |
| `sessionKey` | string | — | `"agent:main:main"` | Agent session key for routing system events |

## System event format

When an email arrives, the plugin injects a system event like:

```
📧 New email in nickbot@agentmail.to
From: sender@example.com
Subject: Hello there
Preview: This is the first 200 chars of the email body...
```

The event is keyed with `contextKey: agentmail:<messageId>` to deduplicate repeated events for the same message.

## How wake works

After enqueuing a system event, the plugin calls `requestHeartbeatNow()` from the OpenClaw plugin SDK with reason `"wake"`. This bypasses heartbeat file gates and triggers an immediate heartbeat turn so the email is processed right away — no waiting for the next scheduled heartbeat.

**Important config for proactive delivery:**

The heartbeat `target` must be set to a channel (e.g. `"whatsapp"`, `"telegram"`) or `"last"` — otherwise the agent processes the email but the response is silently dropped (default target is `"none"`).

```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "1h",
        "target": "whatsapp"
      }
    }
  }
}
```

**Note:** The `requests-in-flight` check is global — if any conversation is active on any channel, the wake is deferred (retries every 1s until the queue clears).

## Architecture

- **Raw WebSocket** — connects directly to `wss://ws.agentmail.to/v0` with API key as query param (no SDK dependency for the WebSocket layer)
- **Reconnection** — exponential backoff (1s → 2s → 4s → ... → 60s max) with ±10% jitter
- **Keepalive** — sends WebSocket pings every 30 seconds
- **In-process wake** — uses `api.runtime.system.requestHeartbeatNow()` (no HTTP round-trips)
- **System events** — uses `api.runtime.system.enqueueSystemEvent()` to route to the agent session

## Dependencies

- `ws` ^8.18.0 — WebSocket client for Node.js

## License

MIT
