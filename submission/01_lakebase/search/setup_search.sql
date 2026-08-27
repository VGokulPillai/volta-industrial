-- ============================================================================
-- Native hybrid search over operational maintenance notes — Lakebase Postgres
-- ============================================================================
-- Goal: search app.maintenance_notes with BOTH keyword relevance AND semantic
-- similarity, entirely INSIDE Lakebase (no external vector database — the
-- operational records never leave the governed store).
--
-- This file provides TWO tiers:
--   TIER 1 (portable, always available): PostgreSQL full-text search (tsvector
--           + GIN index). This is what the shipping app query uses, so it works
--           on any Lakebase instance with zero extra provisioning.
--   TIER 2 (native hybrid, when enabled): keyword BM25 + pgvector semantic
--           similarity, fused with Reciprocal Rank Fusion (RRF).
--
-- Enable Lakebase Search / the required extensions in the Lakebase project, then
-- run the TIER matching your provisioning. example_queries.sql demonstrates both.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TIER 1 — Keyword full-text search (portable)
-- ─────────────────────────────────────────────────────────────────────────────

-- Generated tsvector column over the searchable text (note + machine type).
ALTER TABLE app.maintenance_notes
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(technician_note, '') || ' ' || coalesce(machine_type, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS maintenance_notes_tsv_idx
    ON app.maintenance_notes USING GIN (search_tsv);

-- Trigram index for fuzzy substring matches on short queries (optional; needs
-- pg_trgm). Safe to skip if the extension is unavailable.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS maintenance_notes_trgm_idx
--     ON app.maintenance_notes USING GIN (technician_note gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- TIER 2 — Semantic vector search (native hybrid; enable when provisioned)
-- ─────────────────────────────────────────────────────────────────────────────
-- Requires pgvector on the Lakebase instance. Embeddings are produced by a
-- Databricks embedding model-serving endpoint and written back into Lakebase —
-- the records stay governed inside Lakebase; only the embedding vector is added.
--
-- CREATE EXTENSION IF NOT EXISTS vector;
--
-- ALTER TABLE app.maintenance_notes
--     ADD COLUMN IF NOT EXISTS note_embedding vector(1024);   -- e.g. databricks-gte-large-en
--
-- CREATE INDEX IF NOT EXISTS maintenance_notes_vec_idx
--     ON app.maintenance_notes USING hnsw (note_embedding vector_cosine_ops);
--
-- Populate note_embedding by scoring each technician_note through the embedding
-- endpoint (batch job or app-side backfill). See example_queries.sql for the
-- hybrid (keyword + vector, RRF-fused) query that uses this column.
