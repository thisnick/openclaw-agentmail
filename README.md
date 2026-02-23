# openclaw-agentmail-listener

An [OpenClaw](https://openclaw.ai) plugin that listens for incoming emails via [AgentMail](https://agentmail.to) WebSocket and injects system events so your AI agent can act on them.

## What it does

- Registers a background service at gateway startup
- Connects to AgentMail via WebSocket
- Subscribes to a configured inbox (e.g. `nickbot@agentmail.to`)
- When a `message.received` event fires, injects a system event via `core.system.enqueueSystemEvent()` with email metadata (from, subject, preview)
- Auto-reconnects with exponential backoff on disconnect
- Stops cleanly when the gateway shuts down

This is **not** a channel plugin — it doesn't handle replies. It just triggers system events so the agent notices new emails and can decide what to do (e.g. read the full message via the AgentMail skill and reply).

## Installation

### Option 1: Install from npm (recommended)

```bash
openclaw plugins install openclaw-agentmail-listener
```

Restart the gateway afterwards.

### Option 2: Install from GitHub

```bash
git clone https://github.com/thisnick/openclaw-agentmail ~/.openclaw/extensions/agentmail-listener
cd ~/.openclaw/extensions/agentmail-listener
npm install
openclaw gateway restart
```

### Option 3: Load via config path

In your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/openclaw-agentmail"]
    }
  }
}
```

Then run `npm install` in the plugin directory and restart the gateway.

## Configuration

Add to your OpenClaw config under `plugins.entries.agentmail-listener.config`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-agentmail-listener": {
        "enabled": true,
        "config": {
          "apiKey": "am_us_your_key_here",
          "inboxId": "yourbot@agentmail.to",
          "eventTypes": ["message.received"],
          "sessionKey": "agent:main:main"
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

## Architecture notes

- The plugin uses the `agentmail` npm package's WebSocket client
- Reconnection uses exponential backoff (1s → 2s → 4s → ... → 60s max) with ±10% jitter
- Re-subscription happens automatically on each reconnect (WebSocket `open` event)
- Uses `api.runtime.system.enqueueSystemEvent()` to route events to the agent session

## Dependencies

- `agentmail` ^0.2.17 — AgentMail TypeScript SDK

## License

MIT
