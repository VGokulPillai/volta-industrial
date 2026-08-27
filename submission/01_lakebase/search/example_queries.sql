-- ============================================================================
-- Hybrid search example queries — Lakebase Postgres
-- Manager's question: "Find historical maintenance notes related to bearing
-- vibration or grinding on similar machines." (Directly tied to LINE-04.)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TIER 1 — Keyword full-text relevance (portable; used by the app)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    note_id,
    line_id,
    machine_type,
    ts_rank(search_tsv, websearch_to_tsquery('english', 'bearing vibration grinding')) AS rank,
    technician_note
FROM app.maintenance_notes
WHERE search_tsv @@ websearch_to_tsquery('english', 'bearing vibration grinding')
ORDER BY rank DESC
LIMIT 10;
-- Expect NOTE-0001 (LINE-04 drive-side bearing vibration + grinding) at/near top,
-- with NOTE-0005 (LINE-04 bearing whine) and NOTE-0004 (grinder vibration) following.

-- Same shape, scoped to the hero machine type (CNC mills) — the LINE-04 tie-in.
SELECT note_id, line_id, technician_note,
       ts_rank(search_tsv, websearch_to_tsquery('english', 'bearing seal spindle')) AS rank
FROM app.maintenance_notes
WHERE machine_type = 'CNC_Mill'
  AND search_tsv @@ websearch_to_tsquery('english', 'bearing seal spindle')
ORDER BY rank DESC
LIMIT 5;

-- ─────────────────────────────────────────────────────────────────────────────
-- TIER 2 — Native hybrid (keyword + semantic), Reciprocal Rank Fusion
-- Requires the pgvector setup + populated note_embedding (see setup_search.sql).
-- :query_text  = the manager's phrase; :query_embedding = its embedding vector.
-- ─────────────────────────────────────────────────────────────────────────────
-- WITH keyword AS (
--     SELECT note_id,
--            row_number() OVER (
--                ORDER BY ts_rank(search_tsv,
--                    websearch_to_tsquery('english', :query_text)) DESC) AS rnk
--     FROM app.maintenance_notes
--     WHERE search_tsv @@ websearch_to_tsquery('english', :query_text)
--     LIMIT 20
-- ),
-- semantic AS (
--     SELECT note_id,
--            row_number() OVER (
--                ORDER BY note_embedding <=> :query_embedding) AS rnk
--     FROM app.maintenance_notes
--     WHERE note_embedding IS NOT NULL
--     ORDER BY note_embedding <=> :query_embedding
--     LIMIT 20
-- )
-- SELECT n.note_id, n.line_id, n.technician_note,
--        -- RRF: sum of 1/(k + rank) across both retrievers (k = 60).
--        coalesce(1.0/(60 + k.rnk), 0) + coalesce(1.0/(60 + s.rnk), 0) AS hybrid_score
-- FROM app.maintenance_notes n
-- LEFT JOIN keyword  k ON k.note_id = n.note_id
-- LEFT JOIN semantic s ON s.note_id = n.note_id
-- WHERE k.note_id IS NOT NULL OR s.note_id IS NOT NULL
-- ORDER BY hybrid_score DESC
-- LIMIT 10;
