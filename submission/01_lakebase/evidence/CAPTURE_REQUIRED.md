# Evidence status — Build 1 (Lakebase)

> **CAPTURED — no manual screenshots required.**
>
> All of the checks below were captured as **live run output** (committed JSON +
> notebooks), which is stronger and reproducible. See
> [`EXECUTION_EVIDENCE.md`](EXECUTION_EVIDENCE.md) and the raw outputs in
> [`output/`](output/).

| Check | Where it's proven (live run) |
|---|---|
| Branch list (production + dev + throwaway) | `output/branch_evidence.json → branches` (all `READY`) |
| Schema diff (agent's `maintenance_actions` + enrichment cols) | `output/lakebase_evidence.json → schema_before / schema_after / agent_added_tables` |
| Isolation — dev change invisible to production | `output/branch_evidence.json → use1_isolation_proof` (`production_sees_dev_row = 0`) |
| Isolation — throwaway what-if invisible to production | `output/branch_evidence.json → use2_isolation_proof` |
| Migration validation output | `output/lakebase_evidence.json → agent_validation` (argmax = `pull_now`, $80k) |
| Hybrid search result | `output/lakebase_evidence.json → search_results` (NOTE-0001, rank 0.41) |
| UC → Lakebase forward sync rows | `output/lakebase_evidence.json → forward_sync_rowcount = 25` |
| Lakebase → UC reverse sync (SCD2 + metadata) | `output/lakebase_evidence.json → reverse_sync_scd2_history_WO_10004` |
| Low-latency domain answer | `output/lakebase_evidence.json → domain_answer` |

Notebooks that produced this evidence:
[`run_evidence_notebook.py`](run_evidence_notebook.py),
[`run_branch_evidence_notebook.py`](run_branch_evidence_notebook.py).
