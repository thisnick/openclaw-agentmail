# openclaw-agentmail-listener

## 0.2.2

### Patch Changes

- [`0b1e2cd`](https://github.com/thisnick/openclaw-agentmail/commit/0b1e2cdfed445666971ad1e60ef72ec226a07787) Thanks [@thisnick](https://github.com/thisnick)! - Wake heartbeat immediately on new email via Gateway HTTP API, so agent processes events without waiting for next scheduled poll

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
