---
"openclaw-agentmail-listener": minor
---

Replace AgentMail SDK websocket client with raw `ws` connection

The SDK's `ReconnectingWebSocket` wrapper has a race condition where the `open`
event fires before `connect()` resolves, causing the plugin to miss the event
and never subscribe to inbox notifications.

This replaces the SDK dependency entirely with a direct WebSocket connection to
`wss://ws.agentmail.to/v0`, implementing our own subscribe, reconnect with
backoff, and keepalive pings. Bundle size drops from ~250kb to 9kb.
