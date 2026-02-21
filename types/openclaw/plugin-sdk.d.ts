/**
 * Minimal type stubs for openclaw/plugin-sdk.
 * These are used for development-time type checking only.
 * At runtime, OpenClaw provides the actual implementation.
 *
 * Generated from openclaw/plugin-sdk public API surface.
 */

declare module "openclaw/plugin-sdk" {
  export interface RuntimeLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
  }

  export interface SystemEventOptions {
    /** Session key to route the event to (required). */
    sessionKey: string;
    /** Optional dedup key — events with the same contextKey are deduplicated. */
    contextKey?: string | null;
  }

  export interface PluginRuntime {
    system: {
      enqueueSystemEvent(text: string, options: SystemEventOptions): void;
    };
    config: {
      loadConfig(): Record<string, unknown>;
      writeConfigFile(config: Record<string, unknown>): Promise<void>;
    };
    state: {
      resolveStateDir(): string;
    };
  }

  export interface OpenClawPluginServiceContext {
    stateDir: string;
  }

  export interface OpenClawPluginService {
    id: string;
    start(ctx: OpenClawPluginServiceContext): Promise<void> | void;
    stop(ctx: OpenClawPluginServiceContext): Promise<void> | void;
  }

  export interface OpenClawPluginApi {
    /** The plugin's config (from plugins.entries.<id>.config in openclaw.json). */
    config: Record<string, unknown> | undefined;
    /** Logger for the plugin. */
    logger: RuntimeLogger;
    /** Runtime helpers (system events, config, state, etc.). */
    runtime: PluginRuntime;
    /** Register a background service with start/stop lifecycle. */
    registerService(service: OpenClawPluginService): void;
  }

  export function emptyPluginConfigSchema(): {
    type: "object";
    additionalProperties: false;
    properties: Record<string, never>;
  };
}
