# Expansion Log

## Wave 1 — team launch (2026-09-28T02:06Z)
Roster requested (8): ingest-pipeline, storage-schema, ai-analysis, commands-ux, web-dashboard, voice-activity, roulette-game, skeptic

### Routing outcomes (requested -> spawned -> fallback reason)
| axis | requested | spawned | result |
|---|---|---|---|
| ingest-pipeline | deep-low | deep-low (gpt-5.6-sol) | RUNNING |
| storage-schema | deep-low | deep-low (gpt-5.6-sol) | RUNNING |
| ai-analysis | unspecified-high | claude-opus-5-5 -> claude-opus-4-6 | ERROR 402 insufficient funds |
| commands-ux | unspecified-low | mimo-v2.6-pro | RUNNING |
| web-dashboard | deep-low | deep-low (gpt-5.6-sol) | RUNNING |
| voice-activity | quick | deepseek-flash-latest | ERROR 403 openrouter key limit |
| roulette-game | quick | deepseek-flash-latest | ERROR 403 openrouter key limit |
| skeptic | ultrabrain | gpt-6-astra | RUNNING |

### Lane failures (infrastructure, not research)
3 of 8 members died on provider errors before producing any work:
- ai-analysis: 402 upstream insufficient account funds (anthropic fallback chain)
- voice-activity, roulette-game: 403 openrouter key total limit exceeded (deepseek route)

The `quick` category currently routes to an exhausted OpenRouter key; `unspecified-high`
falls back to a Claude account with no balance. Routes confirmed working this session:
deep-low (opencode/gpt-5.6-sol), unspecified-low (openrouter xiaomi/mimo-v2.6-pro),
ultrabrain (openai/gpt-6-astra).

### Replacement lanes spawned
The 3 dead axes are re-run as `task` lanes on the confirmed-working deep-low route.
Axis briefs are unchanged; only the transport differs.
