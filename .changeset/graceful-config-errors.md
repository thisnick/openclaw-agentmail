---
"openclaw-agentmail-listener": patch
---

Gracefully handle missing or invalid plugin config instead of crashing. The plugin now validates config types, logs actionable warnings, and skips startup when required fields are missing or malformed.
