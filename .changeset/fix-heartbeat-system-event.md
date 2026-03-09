---
"openclaw-agentmail-listener": patch
---

Fix system events not surfacing in heartbeat prompts

The heartbeat runner only injects system events into the prompt when they are tagged as cron or exec events. Previously, the plugin used `contextKey: "agentmail:..."` and `reason: "wake"`, which caused the heartbeat to fire but silently discard the system event text.

Changes:
- Use `contextKey: "cron:agentmail:..."` so the event is picked up by the `hasTaggedCronEvents` check and included in the heartbeat prompt via `buildCronEventPrompt`
- Use `reason: "exec-event"` instead of `"wake"` to ensure pending events are inspected (both bypass file gates, but only `exec-event` enables `shouldInspectPendingEvents`)
