# Connected Demo Script — one story, three builds

Target length ~6–8 minutes. This is ONE narrative, not three product demos.

## Setup (before the room)

- App running (`app/start.sh` or deployed) with `GENIE_SPACE_ID` + Lakebase wired.
- Lakebase branches created (production / development / dev/maintenance-agent).
- AI Gateway applied on the agent endpoint (`03_ai_gateway/config/apply_gateway_config.sh`).
- Two SQL tabs open: one on Lakebase (branch isolation), one on Databricks SQL
  (`system.ai_gateway.usage`).

## The flow

1. **Open Volta Plant Floor.** The fleet across ~8 plants; risk overview.
2. Show the machine-risk overview — critical lines rise to the top.
3. **Highlight LINE-04** (PLANT-03) at the top.
4. **Open LINE-04.** Show: failure risk ≈ 87% (critical), vibration deterioration,
   temperature deterioration, open corrective WO, **replacement part not local**.
5. **Ask Genie:** *"Why is LINE-04 trending toward a stop?"* → the Thinking panel
   shows the `ask_data` (Genie) investigation over governed analytical data.
6. Genie returns the synthesized "why" (rising telemetry, risk, non-local part).
7. **Ask:** *"Pull it now or run until shift end?"* → *"Rank the action. Use the model."*
8. App compares the three plays (pull_now / run_to_shift_end / expedite) with
   predicted cost avoided + net value.
9. **Recommendation: PULL NOW** — the part isn't local, so an unplanned stop is
   far costlier than a planned pull.
10. The agent **drafts a planned-maintenance work order** and STOPS.
11. **Require manager approval** — nothing is written yet (no silent AI write).
12. **Approve** ("Yes — pull the line now.").
13. **Show the Lakebase work order updated** — `app.work_orders_app` row
    (status=approved, approved_by=you); the floor view updates live.
14. **Segue to Lakebase development:** "this operational database was developed
    safely using isolated Lakebase branches."
15. **Show the dev/maintenance-agent branch** (branch list).
16. **Show the schema change isolated from production** — run
    `01_lakebase/queries/verify_branch_isolation.sql` on the agent branch
    (table exists) then production (table absent; fleet intact).
17. **Show hybrid search** over maintenance notes —
    `01_lakebase/search/example_queries.sql` "bearing vibration grinding" → LINE-04
    note at the top.
18. **Move to Unity AI Gateway.**
19. Show that every generative app request is **bounded** (rate limits),
    **visible** (usage), **attributable** (tags) — `03_ai_gateway/config` +
    `queries/executive_usage.sql`.
20. **Find the LINE-04 AI interaction** in usage tracking (filter
    `request_tags['line_id']='LINE-04'`).
21. **Explain the $1,200 incident** — with usage + inference logs + tags, that
    runaway request could now be **investigated** (what was asked) and is
    **bounded** (can't recur unbounded). `EXECUTIVE_REPORT.md`.

## The one-sentence close

> Lakebase holds the live operational state and supports safe branch-based
> development, the app gives the plant manager a real-time decision surface with
> Genie for investigation, and Unity AI Gateway keeps the AI spend bounded,
> visible, and attributable — one governed loop from telemetry to floor action.
