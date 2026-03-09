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

The event is keyed with `contextKey: cron:agentmail:<messageId>` so it is both deduplicated and surfaced in the heartbeat prompt (see [How wake works](#how-wake-works) for details).

## How wake works

After enqueuing a system event, the plugin calls `requestHeartbeatNow()` with reason `"exec-event"`. This does two things:

1. **Bypasses file gates** — the heartbeat fires immediately without requiring HEARTBEAT.md
2. **Inspects pending events** — the enqueued system event is included in the heartbeat prompt

The `cron:` prefix on the contextKey ensures the event passes through OpenClaw's `hasTaggedCronEvents` check, which enables event inspection and renders the email content via `buildCronEventPrompt`. Without this prefix, the event would be enqueued but silently discarded from the prompt.

> **Why not `reason: "wake"`?** The `"wake"` reason bypasses file gates but does _not_ enable `shouldInspectPendingEvents` in the heartbeat runner, so system events are ignored. `"exec-event"` enables both.

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
- **In-process wake** — uses `api.runtime.system.requestHeartbeatNow()` with `reason: "exec-event"` (no HTTP round-trips)
- **System events** — uses `api.runtime.system.enqueueSystemEvent()` with `cron:`-prefixed contextKey to ensure prompt visibility

## Dependencies

- `ws` ^8.18.0 — WebSocket client for Node.js

## License

MIT
