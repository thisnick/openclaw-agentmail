/**
 * openclaw-agentmail: AgentMail listener plugin for OpenClaw
 *
 * Connects to AgentMail via WebSocket, subscribes to a configured inbox,
 * and injects system events when emails arrive so the agent can act on them.
 *
 * This is NOT a channel plugin — it doesn't handle replies. It just triggers
 * system events for the agent to notice and decide what to do.
 */

import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";
import { AgentMailClient } from "agentmail";
import type { AgentMail } from "agentmail";

// ---------------------------------------------------------------------------
// Config types (must match configSchema in openclaw.plugin.json)
// ---------------------------------------------------------------------------

type WakeMode = "tools-invoke" | "hooks" | "off";

interface AgentMailConfig {
  apiKey: string;
  inboxId: string;
  /**
   * Optional list of event types to subscribe to.
   * Defaults to ["message.received"].
   */
  eventTypes?: string[];
  /**
   * Session key to route system events to. Defaults to "agent:main:main".
   * Set this if you're using a non-default agent session.
   */
  sessionKey?: string;
  /**
   * How to wake the agent on new email.
   * - "tools-invoke" (default): POST to /tools/invoke with cron wake action (uses gateway.auth.token)
   * - "hooks": POST to /hooks/wake (uses hooks.token, requires hooks.enabled)
   * - "off": Don't wake — rely on heartbeat polling
   */
  wake?: WakeMode;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  api.registerService({
    id: "agentmail-listener",
    start: async () => {
      const cfg = (api.pluginConfig ?? api.config) as { apiKey?: string; inboxId?: string; eventTypes?: string[]; sessionKey?: string; wake?: string } | undefined;

      if (!cfg?.apiKey) {
        api.logger.warn("agentmail-listener: no apiKey configured — service not starting");
        return;
      }
      if (!cfg?.inboxId) {
        api.logger.warn("agentmail-listener: no inboxId configured — service not starting");
        return;
      }

      const wakeMode = (cfg.wake === "hooks" || cfg.wake === "off") ? cfg.wake : "tools-invoke";

      const pluginCfg: AgentMailConfig = {
        apiKey: cfg.apiKey,
        inboxId: cfg.inboxId,
        eventTypes: cfg.eventTypes ?? ["message.received"],
        sessionKey: cfg.sessionKey ?? "agent:main:main",
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

let currentSocket: { close: () => void } | null = null;
let stopped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function stopListener(): void {
  stopped = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (currentSocket) {
    try {
      currentSocket.close();
    } catch {
      // ignore
    }
    currentSocket = null;
  }
}

// ---------------------------------------------------------------------------
// Listener logic
// ---------------------------------------------------------------------------

function startListener(api: OpenClawPluginApi, cfg: AgentMailConfig): void {
  stopped = false;
  connectWithBackoff(api, cfg, 0);
}

/**
 * Connect (or reconnect) to AgentMail WebSocket.
 * The agentmail SDK wraps ReconnectingWebSocket internally, but we still need
 * to re-subscribe after each open event — so we manage that ourselves.
 * We also add our own outer retry loop for fatal errors (e.g. bad auth).
 */
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

  try {
    const client = new AgentMailClient({ apiKey: cfg.apiKey });

    // Connect — the SDK uses ReconnectingWebSocket internally.
    // We pass reconnectAttempts=0 so the SDK does NOT auto-reconnect;
    // instead we handle reconnection ourselves so we can re-subscribe
    // and log properly.
    // Pass apiKey as query param — Node's native WebSocket doesn't support
    // custom headers, so the auth header alone won't work in Node.js.
    const socket = await client.websockets.connect({ reconnectAttempts: 0, apiKey: cfg.apiKey });
    currentSocket = socket;

    socket.on("open", () => {
      if (stopped) return;
      api.logger.info(
        `agentmail-listener: connected, subscribing to ${cfg.inboxId}`,
      );
      try {
        socket.sendSubscribe({
          type: "subscribe",
          inboxIds: [cfg.inboxId],
          // Only pass eventTypes if the caller specified them (undefined = all)
          ...(cfg.eventTypes ? { eventTypes: cfg.eventTypes as AgentMail.EventType[] } : {}),
        });
      } catch (err) {
        api.logger.error(`agentmail-listener: failed to send subscribe: ${String(err)}`);
      }
    });

    socket.on("message", (event) => {
      if (stopped) return;
      handleEvent(api, cfg, event);
    });

    socket.on("close", (closeEvent) => {
      if (stopped) return;
      api.logger.warn(
        `agentmail-listener: disconnected (code=${closeEvent.code}) — will reconnect`,
      );
      currentSocket = null;
      // Schedule reconnect
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWithBackoff(api, cfg, attempt + 1);
      }, backoffDelay(attempt + 1));
    });

    socket.on("error", (err) => {
      api.logger.error(`agentmail-listener: WebSocket error: ${String(err)}`);
      // The close event will fire next and handle reconnect.
    });

  } catch (err) {
    api.logger.error(`agentmail-listener: failed to connect: ${String(err)}`);
    currentSocket = null;
    if (!stopped) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWithBackoff(api, cfg, attempt + 1);
      }, backoffDelay(attempt + 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

type WebSocketEvent =
  | AgentMail.Subscribed
  | AgentMail.MessageReceivedEvent
  | AgentMail.MessageSentEvent
  | AgentMail.MessageDeliveredEvent
  | AgentMail.MessageBouncedEvent
  | AgentMail.MessageComplainedEvent
  | AgentMail.MessageRejectedEvent
  | AgentMail.DomainVerifiedEvent
  | AgentMail.Error_;

function handleEvent(api: OpenClawPluginApi, cfg: AgentMailConfig, event: WebSocketEvent): void {
  // Log subscription confirmations
  if (event.type === "subscribed") {
    const subscribed = event as AgentMail.Subscribed;
    api.logger.info(
      `agentmail-listener: subscribed to inboxes: ${(subscribed.inboxIds ?? []).join(", ")}`,
    );
    return;
  }

  // Handle incoming messages
  if (event.type === "event") {
    const msgEvent = event as AgentMail.MessageReceivedEvent;
    if (msgEvent.eventType !== "message.received") {
      // Not a message.received event — skip
      return;
    }

    const msg = msgEvent.message;
    const from = msg.from ?? "(unknown sender)";
    const subject = msg.subject ?? "(no subject)";
    const preview = (msg.preview ?? msg.text ?? "").slice(0, 200).replace(/\s+/g, " ").trim();
    const messageId = msg.messageId ?? msgEvent.eventId ?? "unknown";

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
    const errorEvent = event as AgentMail.Error_;
    api.logger.error(
      `agentmail-listener: server error [${errorEvent.name}]: ${errorEvent.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Agent wake via gateway HTTP API
// ---------------------------------------------------------------------------

async function wakeAgent(api: OpenClawPluginApi, mode: WakeMode, wakeText: string): Promise<void> {
  if (mode === "off") return;

  const cfg = api.runtime.config.loadConfig();
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

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;

function backoffDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  const delay = MIN_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  // Add ±10% jitter to avoid thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(MAX_DELAY_MS, Math.round(delay + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
