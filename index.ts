/**
 * openclaw-agentmail: AgentMail listener plugin for OpenClaw
 *
 * Connects to AgentMail via raw WebSocket (bypassing the SDK's buggy
 * ReconnectingWebSocket wrapper), subscribes to a configured inbox,
 * and injects system events when emails arrive so the agent can act on them.
 *
 * This is NOT a channel plugin — it doesn't handle replies. It just triggers
 * system events for the agent to notice and decide what to do.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Config types (must match configSchema in openclaw.plugin.json)
// ---------------------------------------------------------------------------

type WakeMode = "tools-invoke" | "hooks" | "off";

interface AgentMailConfig {
  apiKey: string;
  inboxId: string;
  eventTypes?: string[];
  sessionKey?: string;
  wake?: WakeMode;
}

// ---------------------------------------------------------------------------
// AgentMail WebSocket protocol types
// ---------------------------------------------------------------------------

interface SubscribeMessage {
  type: "subscribe";
  inboxIds: string[];
  eventTypes?: string[];
}

interface SubscribedResponse {
  type: "subscribed";
  organization_id?: string;
  inboxIds?: string[];
}

interface EmailMessage {
  inbox_id?: string;
  thread_id?: string;
  message_id?: string;
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  preview?: string;
  extracted_text?: string;
}

interface MessageReceivedEvent {
  type: "event";
  event_type: "message.received";
  event_id?: string;
  message: EmailMessage;
}

interface ErrorResponse {
  type: "error";
  name?: string;
  message?: string;
}

type AgentMailEvent = SubscribedResponse | MessageReceivedEvent | ErrorResponse | { type: string; event_type?: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_BASE_URL = "wss://ws.agentmail.to/v0";
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;
const PING_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  api.registerService({
    id: "agentmail-listener",
    start: async () => {
      let cfg: Record<string, unknown> | undefined;
      try {
        cfg = (api.pluginConfig ?? api.config) as Record<string, unknown> | undefined;
      } catch (err) {
        api.logger.error(`agentmail-listener: failed to read plugin config — service not starting: ${String(err)}`);
        return;
      }

      if (!cfg || typeof cfg !== "object") {
        api.logger.warn("agentmail-listener: no config provided — service not starting");
        return;
      }

      if (!cfg.apiKey || typeof cfg.apiKey !== "string") {
        api.logger.warn(
          `agentmail-listener: apiKey is ${cfg.apiKey === undefined ? "missing" : "not a string"} — service not starting. ` +
          "Set plugins.entries.openclaw-agentmail-listener.config.apiKey in your OpenClaw config.",
        );
        return;
      }
      if (!cfg.inboxId || typeof cfg.inboxId !== "string") {
        api.logger.warn(
          `agentmail-listener: inboxId is ${cfg.inboxId === undefined ? "missing" : "not a string"} — service not starting. ` +
          "Set plugins.entries.openclaw-agentmail-listener.config.inboxId in your OpenClaw config.",
        );
        return;
      }

      if (cfg.eventTypes !== undefined && !Array.isArray(cfg.eventTypes)) {
        api.logger.warn("agentmail-listener: eventTypes must be an array — ignoring invalid value");
      }

      if (cfg.sessionKey !== undefined && typeof cfg.sessionKey !== "string") {
        api.logger.warn("agentmail-listener: sessionKey must be a string — using default");
      }

      const wakeMode = (cfg.wake === "hooks" || cfg.wake === "off") ? cfg.wake : "tools-invoke";

      const pluginCfg: AgentMailConfig = {
        apiKey: cfg.apiKey,
        inboxId: cfg.inboxId,
        eventTypes: Array.isArray(cfg.eventTypes) ? cfg.eventTypes as string[] : ["message.received"],
        sessionKey: typeof cfg.sessionKey === "string" ? cfg.sessionKey : "agent:main:main",
        wake: wakeMode,
      };

      startListener(api, pluginCfg);
    },
    stop: async () => {
      stopListener();
    },
  });
}

// ---------------------------------------------------------------------------
// Listener state
// ---------------------------------------------------------------------------

let currentWs: WebSocket | null = null;
let stopped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function stopListener(): void {
  stopped = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (currentWs) {
    try {
      currentWs.close(1000, "plugin stopping");
    } catch {
      // ignore
    }
    currentWs = null;
  }
}

// ---------------------------------------------------------------------------
// Listener logic — raw WebSocket with manual reconnect
// ---------------------------------------------------------------------------

function startListener(api: OpenClawPluginApi, cfg: AgentMailConfig): void {
  stopped = false;
  connectWithBackoff(api, cfg, 0);
}

async function connectWithBackoff(
  api: OpenClawPluginApi,
  cfg: AgentMailConfig,
  attempt: number,
): Promise<void> {
  if (stopped) return;

  const delay = backoffDelay(attempt);
  if (attempt > 0) {
    api.logger.info(
      `agentmail-listener: reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt})`,
    );
    await sleep(delay);
    if (stopped) return;
  }

  const url = `${WS_BASE_URL}?api_key=${encodeURIComponent(cfg.apiKey)}`;

  try {
    const ws = new WebSocket(url);
    currentWs = ws;

    ws.on("open", () => {
      if (stopped) return;
      api.logger.info(`agentmail-listener: connected to ${WS_BASE_URL}, subscribing to ${cfg.inboxId}`);

      // Send subscribe message
      const subscribe: SubscribeMessage = {
        type: "subscribe",
        inboxIds: [cfg.inboxId],
        ...(cfg.eventTypes ? { eventTypes: cfg.eventTypes } : {}),
      };

      try {
        ws.send(JSON.stringify(subscribe));
      } catch (err) {
        api.logger.error(`agentmail-listener: failed to send subscribe: ${String(err)}`);
      }

      // Start keepalive pings
      if (pingTimer !== null) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, PING_INTERVAL_MS);
    });

    ws.on("message", (data) => {
      if (stopped) return;
      try {
        const event = JSON.parse(data.toString()) as AgentMailEvent;
        handleEvent(api, cfg, event);
      } catch (err) {
        api.logger.error(`agentmail-listener: failed to parse message: ${String(err)}`);
      }
    });

    ws.on("close", (code, reason) => {
      if (stopped) return;
      api.logger.warn(
        `agentmail-listener: disconnected (code=${code} reason=${reason?.toString() ?? ""}) — will reconnect`,
      );
      cleanup();
      scheduleReconnect(api, cfg, code === 1000 ? 0 : attempt + 1);
    });

    ws.on("error", (err) => {
      api.logger.error(`agentmail-listener: WebSocket error: ${String(err)}`);
      // close event will follow and handle reconnect
    });

  } catch (err) {
    api.logger.error(`agentmail-listener: failed to connect: ${String(err)}`);
    cleanup();
    if (!stopped) {
      scheduleReconnect(api, cfg, attempt + 1);
    }
  }
}

function cleanup(): void {
  currentWs = null;
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function scheduleReconnect(api: OpenClawPluginApi, cfg: AgentMailConfig, attempt: number): void {
  if (stopped) return;
  const delay = backoffDelay(attempt);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWithBackoff(api, cfg, attempt);
  }, delay);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvent(api: OpenClawPluginApi, cfg: AgentMailConfig, event: AgentMailEvent): void {
  try {
    handleEventInner(api, cfg, event);
  } catch (err) {
    api.logger.error(`agentmail-listener: unhandled error processing event: ${String(err)}`);
  }
}

function handleEventInner(api: OpenClawPluginApi, cfg: AgentMailConfig, event: AgentMailEvent): void {
  // Log subscription confirmations
  if (event.type === "subscribed") {
    const subscribed = event as SubscribedResponse;
    api.logger.info(
      `agentmail-listener: subscribed (org=${subscribed.organization_id ?? "unknown"})`,
    );
    return;
  }

  // Handle incoming messages
  if (event.type === "event") {
    const msgEvent = event as MessageReceivedEvent;
    if (msgEvent.event_type !== "message.received") {
      // Not a message.received event — skip
      return;
    }

    const msg = msgEvent.message;
    const from = msg.from ?? "(unknown sender)";
    const subject = msg.subject ?? "(no subject)";
    const preview = (msg.preview ?? msg.extracted_text ?? msg.text ?? "").slice(0, 200).replace(/\s+/g, " ").trim();
    const messageId = msg.message_id ?? msgEvent.event_id ?? "unknown";

    const eventText = [
      `📧 New email in ${cfg.inboxId}`,
      `From: ${from}`,
      `Subject: ${subject}`,
      preview ? `Preview: ${preview}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    api.logger.info(
      `agentmail-listener: email received from=${from} subject="${subject}" id=${messageId}`,
    );

    try {
      api.runtime.system.enqueueSystemEvent(eventText, {
        sessionKey: cfg.sessionKey ?? "agent:main:main",
        contextKey: `agentmail:${messageId}`,
      });

      // Wake the agent immediately
      const wakeText = "You have a new agentmail email. Check the pending system event for details.";
      wakeAgent(api, cfg.wake ?? "tools-invoke", wakeText).catch((err) => {
        api.logger.warn(`agentmail-listener: wake failed (event still queued): ${String(err)}`);
      });
    } catch (err) {
      api.logger.error(`agentmail-listener: failed to enqueue system event: ${String(err)}`);
    }
    return;
  }

  // Log errors from server
  if (event.type === "error") {
    const errorEvent = event as ErrorResponse;
    api.logger.error(
      `agentmail-listener: server error [${errorEvent.name ?? "unknown"}]: ${errorEvent.message ?? "no message"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Agent wake via gateway HTTP API
// ---------------------------------------------------------------------------

async function wakeAgent(api: OpenClawPluginApi, mode: WakeMode, wakeText: string): Promise<void> {
  if (mode === "off") return;

  let cfg: Record<string, any>;
  try {
    cfg = api.runtime.config.loadConfig();
  } catch (err) {
    api.logger.warn(`agentmail-listener: failed to load runtime config for wake — skipping wake: ${String(err)}`);
    return;
  }
  const port = cfg.gateway?.port ?? 18789;

  if (mode === "hooks") {
    const hooksToken = (cfg.hooks as { token?: string } | undefined)?.token;
    if (!hooksToken) {
      api.logger.warn("agentmail-listener: wake=hooks but no hooks.token configured");
      return;
    }
    const hooksPath = ((cfg.hooks as { path?: string } | undefined)?.path ?? "/hooks").replace(/\/+$/, "");
    const url = `http://127.0.0.1:${port}${hooksPath}/wake`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hooksToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: wakeText, mode: "now" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`hooks/wake returned ${res.status}: ${body}`);
    }
    api.logger.info("agentmail-listener: agent wake triggered via hooks");
    return;
  }

  // Default: tools-invoke
  const gatewayToken = (cfg.gateway?.auth as { token?: string } | undefined)?.token;
  if (!gatewayToken) {
    api.logger.warn("agentmail-listener: wake=tools-invoke but no gateway.auth.token configured");
    return;
  }
  const url = `http://127.0.0.1:${port}/tools/invoke`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: "cron",
      args: {
        action: "wake",
        text: wakeText,
        mode: "now",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tools/invoke cron wake returned ${res.status}: ${body}`);
  }
  api.logger.info("agentmail-listener: agent wake triggered via tools/invoke");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function backoffDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  const delay = MIN_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(MAX_DELAY_MS, Math.round(delay + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
