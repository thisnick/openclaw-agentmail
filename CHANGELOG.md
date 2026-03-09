# openclaw-agentmail-listener

## 0.4.3

### Patch Changes

- [#26](https://github.com/thisnick/openclaw-agentmail/pull/26) [`f3c37a3`](https://github.com/thisnick/openclaw-agentmail/commit/f3c37a3faeadb9c662b466343f5a8d67d6f00b69) Thanks [@thisnick](https://github.com/thisnick)! - Fix system events not surfacing in heartbeat prompts

  The heartbeat runner only injects system events into the prompt when they are tagged as cron or exec events. Previously, the plugin used `contextKey: "agentmail:..."` and `reason: "wake"`, which caused the heartbeat to fire but silently discard the system event text.

  Changes:

  - Use `contextKey: "cron:agentmail:..."` so the event is picked up by the `hasTaggedCronEvents` check and included in the heartbeat prompt via `buildCronEventPrompt`
  - Use `reason: "exec-event"` instead of `"wake"` to ensure pending events are inspected (both bypass file gates, but only `exec-event` enables `shouldInspectPendingEvents`)

## 0.4.2

### Patch Changes

- Fix heartbeat wake reason and update README

  - Use `"wake"` as heartbeat reason to bypass file gates (was using custom string that resolved to "other")
  - Update README to reflect raw WebSocket architecture and removal of wake config
  - Remove references to agentmail SDK dependency and HTTP wake methods

## 0.4.1

### Patch Changes

- Use requestHeartbeatNow for agent wake instead of HTTP calls

  Replace the HTTP-based wake mechanism (tools-invoke / hooks) with the
  in-process `requestHeartbeatNow()` from the plugin SDK. The plugin runs
  inside the gateway process, so HTTP round-trips are unnecessary. Removes
  the `wake` config option.

## 0.4.0

### Minor Changes

- [#24](https://github.com/thisnick/openclaw-agentmail/pull/24) [`e8a1f07`](https://github.com/thisnick/openclaw-agentmail/commit/e8a1f07695e1ed93742a1676de0f9670480ae3f1) Thanks [@thisnick](https://github.com/thisnick)! - Replace AgentMail SDK websocket client with raw `ws` connection

  The SDK's `ReconnectingWebSocket` wrapper has a race condition where the `open`
  event fires before `connect()` resolves, causing the plugin to miss the event
  and never subscribe to inbox notifications.

  This replaces the SDK dependency entirely with a direct WebSocket connection to
  `wss://ws.agentmail.to/v0`, implementing our own subscribe, reconnect with
  backoff, and keepalive pings. Bundle size drops from ~250kb to 9kb.

## 0.3.2

### Patch Changes

- [#20](https://github.com/thisnick/openclaw-agentmail/pull/20) [`a1b15e4`](https://github.com/thisnick/openclaw-agentmail/commit/a1b15e4ba8e9edc6da4774ea2546acb777a6b67d) Thanks [@thisnick](https://github.com/thisnick)! - Switch to pnpm and OIDC trusted publishing

- [#14](https://github.com/thisnick/openclaw-agentmail/pull/14) [`8cc3e11`](https://github.com/thisnick/openclaw-agentmail/commit/8cc3e11d14b17bdee6c06ed518d36dfb46b59636) Thanks [@thisnick](https://github.com/thisnick)! - Gracefully handle missing or invalid plugin config instead of crashing. The plugin now validates config types, logs actionable warnings, and skips startup when required fields are missing or malformed.

## 0.3.1

### Patch Changes

- [#11](https://github.com/thisnick/openclaw-agentmail/pull/11) [`1f78bf4`](https://github.com/thisnick/openclaw-agentmail/commit/1f78bf4d30d8f5bafa8b9177f8dbf1cbfee7274a) Thanks [@thisnick](https://github.com/thisnick)! - Update agentmail SDK to 0.4.2 and openclaw to 2026.3.2

## 0.3.0

### Minor Changes

- [`4aa1381`](https://github.com/thisnick/openclaw-agentmail/commit/4aa138119f937e6e9771f75774266683f473af6d) Thanks [@thisnick](https://github.com/thisnick)! - Wake agent immediately on new email instead of waiting for heartbeat poll. Configurable via `wake` option: `"tools-invoke"` (default), `"hooks"`, or `"off"`.

## 0.2.1

### Patch Changes

- [`9f01d6e`](https://github.com/thisnick/openclaw-agentmail/commit/9f01d6ed8d9c80a244f90d28c1931edd5eb62a33) Thanks [@thisnick](https://github.com/thisnick)! - Fix default sessionKey and OpenClaw URL in README

## 0.2.0

### Minor Changes

- [`7912101`](https://github.com/thisnick/openclaw-agentmail/commit/79121019c7c5cf493538c85b255854db59ce02b4) Thanks [@thisnick](https://github.com/thisnick)! - Align plugin structure with agent-wechat patterns: ESM format, proper openclaw devDep for types, move changesets to devDeps, remove as-any casts, add publishConfig provenance

### Patch Changes

- [`30a771d`](https://github.com/thisnick/openclaw-agentmail/commit/30a771d881dab85ba520a02b2e102ae75cd1c79c) Thanks [@thisnick](https://github.com/thisnick)! - Fix default sessionKey: use "agent:main:main" instead of "main" so events are delivered to the correct session queue

## 0.1.4

### Patch Changes

- [`9d6ef94`](https://github.com/thisnick/openclaw-agentmail/commit/9d6ef94789d88883dc0ebdc1a2c562e5425082d8) Thanks [@thisnick](https://github.com/thisnick)! - Remove unreliable shell-based heartbeat wake; rely on enqueueSystemEvent only

## 0.1.3

### Patch Changes

- [#3](https://github.com/thisnick/openclaw-agentmail/pull/3) [`66a0ffe`](https://github.com/thisnick/openclaw-agentmail/commit/66a0ffefe477b2e886d6d7b96875f2bf1207f99e) Thanks [@thisnick](https://github.com/thisnick)! - Fix plugin id mismatch: align manifest id with npm package name

## 0.1.2

### Patch Changes

- [`8292a98`](https://github.com/thisnick/openclaw-agentmail/commit/8292a983d0e7f22e7926261648fd3e73a376a524) Thanks [@thisnick](https://github.com/thisnick)! - Update README with npm install instructions and improve documentation

## 0.1.1

### Patch Changes

- Initial published release with CI/CD pipeline and changesets support
