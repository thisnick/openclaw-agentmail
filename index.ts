/**
 * openclaw-agentmail: AgentMail listener plugin for OpenClaw
 *
 * Connects to AgentMail via WebSocket, subscribes to a configured inbox,
 * and injects system events when emails arrive so the agent can act on them.
 *
 * This is NOT a channel plugin — it doesn't handle replies. It just triggers
 * system events for the agent to notice and decide what to do.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { AgentMailClient } from "agentmail";
import type { AgentMail } from "agentmail";

// ---------------------------------------------------------------------------
// Config types (must match configSchema in openclaw.plugin.json)
// ---------------------------------------------------------------------------

interface AgentMailConfig {
  apiKey: string;
  inboxId: string;
  /**
   * Optional list of event types to subscribe to.
   * Defaults to ["message.received"].
   */
  eventTypes?: string[];
  /**
   * Session key to route system events to. Defaults to "main".
   * Set this if you're using a non-default agent session.
   */
  sessionKey?: string;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  api.registerService({
    id: "agentmail-listener",
    start: async () => {
      const cfg = (api.pluginConfig ?? api.config) as { apiKey?: string; inboxId?: string; eventTypes?: string[]; sessionKey?: string } | undefined;

      if (!cfg?.apiKey) {
        api.logger.warn("agentmail-listener: no apiKey configured — service not starting");
        return;
      }
      if (!cfg?.inboxId) {
        api.logger.warn("agentmail-listener: no inboxId configured — service not starting");
        return;
      }

      const pluginCfg: AgentMailConfig = {
        apiKey: cfg.apiKey,
        inboxId: cfg.inboxId,
        eventTypes: cfg.eventTypes ?? ["message.received"],
        sessionKey: cfg.sessionKey ?? "main",
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

    // Reset attempt counter on successful connection
    // (we do this by catching a successful open via the "open" handler above)
    attempt = 0; // eslint-disable-line no-param-reassign

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
      (api.runtime as any).system.enqueueSystemEvent(eventText, {
        sessionKey: cfg.sessionKey ?? "agent:main:main",
        contextKey: `agentmail:${messageId}`,
      });
      // Trigger an immediate heartbeat so the agent processes the event now.
      // enqueueSystemEvent only queues — it doesn't wake the heartbeat runner.
      // We need requestHeartbeatNow which isn't exposed on the plugin API.
      // Access it from the runtime's internal exports if available.
      const rhbn = (api.runtime as any)?.requestHeartbeatNow
        ?? (api.runtime as any)?.system?.requestHeartbeatNow;
      if (typeof rhbn === "function") {
        rhbn({ reason: "agentmail:new-email" });
        api.logger.info("agentmail-listener: heartbeat wake requested");
      } else {
        // Last resort: shell out to CLI
        try {
          require("child_process").execSync(
            'node /app/openclaw.mjs system event --text "📧 New email — check agentmail inbox" --mode now',
            { timeout: 5000, stdio: "ignore" }
          );
          api.logger.info("agentmail-listener: triggered wake via CLI");
        } catch {
          api.logger.warn("agentmail-listener: could not trigger heartbeat wake");
        }
      }
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
