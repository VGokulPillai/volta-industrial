# AI Gateway rate-limit rationale — Volta maintenance assistant

The Head of AI requires AI spend that is **bounded**. Below is the sizing that
produces the limits in `ai_gateway_config.json`. Numbers are derived, not
arbitrary — the goal is that **one forgotten request pattern cannot create
unlimited throughput** (the $1,200 runaway-request incident must be impossible to
repeat unbounded).

## Workload assumptions (8-plant rollout)

| Driver | Estimate | Basis |
|---|---|---|
| Concurrent plant managers (peak) | 16 | ~2 active per plant during an incident across 8 plants. |
| Questions per manager per active minute (peak) | 2 | Bursty during an incident; the 3-step hero script fired quickly. |
| Model requests per question | 5 | Agent loop = reasoning + tool round-trips (find_atrisk_line, rank, draft, etc.) each triggers a model call. |
| Avg tokens per model request (in+out) | ~6,000 | System instructions (~2.5K) + context + tool outputs in; ~0.5–1.5K out. |
| Max acceptable burst multiple | 1.5× | Short spikes tolerated without throttling normal use. |

## Derived upper bounds

```text
Peak requests/min (service)  = 16 managers × 2 q/min × 5 req/q          = 160 req/min
With 1.5× burst headroom                                               ≈ 240 req/min  → round to 300

Peak tokens/min (service)    = 300 req/min × 6,000 tokens               = 1,800,000 tpm → cap 2,000,000

Per-user requests/min        = 2 q/min × 5 req/q = 10; bound a loop     → 60 req/min
Per-user tokens/min          = 60 req/min × 6,000 tokens                = 360,000 tpm  → cap 400,000
```

## Why these bound the incident

- **Per-user QPM = 60** and **per-user TPM = 400,000**: a single forgotten/looping
  request pattern for one user is capped at 60 requests and 400K tokens **per
  minute**. It cannot silently accelerate — the Gateway throttles (HTTP 429) past
  the cap. A 2-hour runaway is now bounded to a known, small per-minute rate that
  is alarmable long before it becomes material.
- **Service QPM = 300** and **service TPM = 2,000,000**: the whole application is
  bounded regardless of how many users or patterns misbehave at once. Total AI
  spend has a hard ceiling per minute → a predictable maximum per plant and across
  the fleet of 8.
- **Request tags** (application / plant_id / feature / user_id) mean any throttled
  or spiking traffic is immediately attributable (see `../queries/`).

## Chosen limits (see `ai_gateway_config.json`)

| Scope (key) | Requests/min (QPM) | Tokens/min (TPM) |
|---|---|---|
| `endpoint` (service-wide) | 300 | 2,000,000 |
| `user` (per plant manager) | 60 | 400,000 |

> Token-per-minute (TPM) limits are applied where the workspace/endpoint supports
> token-based rate limiting; calls-per-minute (QPM) limits are always applied.
> Tune after observing real usage from `../queries/executive_usage.sql` — start
> conservative, raise only with evidence.
