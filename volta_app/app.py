"""FastAPI backend for the Volta Plant Floor React application."""

from __future__ import annotations

import json
import math
import os
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool


CATALOG = os.getenv("VOLTA_CATALOG", "serverless_stable_wx20co_catalog")
SCHEMA = os.getenv("VOLTA_SCHEMA", "dev_gokul_pillai_volta_industrial")
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "")
GENIE_SPACE_ID = os.getenv("GENIE_SPACE_ID", "")
FQ = f"{CATALOG}.{SCHEMA}"
FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"

app = FastAPI(
    title="Volta Plant Floor API",
    version="2.0.0",
    description="Predictive maintenance operations powered by Databricks.",
)


class GenieRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1_000)


def workspace_client() -> WorkspaceClient:
    """Use Databricks App service-principal credentials injected at runtime."""
    return WorkspaceClient()


def json_value(value: Any) -> Any:
    """Normalize SDK/SQL values into strict JSON values."""
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return value if not isinstance(value, float) or math.isfinite(value) else None
    if isinstance(value, (dict, list, bool)):
        return value
    return str(value)


def execute_sql(statement: str) -> list[dict[str, Any]]:
    if not WAREHOUSE_ID:
        raise RuntimeError("DATABRICKS_WAREHOUSE_ID is not configured")

    client = workspace_client()
    response = client.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=WAREHOUSE_ID,
        catalog=CATALOG,
        schema=SCHEMA,
        wait_timeout="30s",
    )
    statement_id = response.statement_id
    state = response.status.state
    while state in (StatementState.PENDING, StatementState.RUNNING):
        time.sleep(0.75)
        response = client.statement_execution.get_statement(statement_id)
        state = response.status.state

    if state != StatementState.SUCCEEDED:
        error = response.status.error if response.status else None
        raise RuntimeError(getattr(error, "message", None) or "SQL statement failed")

    columns = [column.name for column in response.manifest.schema.columns]
    rows = response.result.data_array if response.result and response.result.data_array else []
    return [
        {column: json_value(value) for column, value in zip(columns, row)}
        for row in rows
    ]


def fleet_query() -> list[dict[str, Any]]:
    return execute_sql(
        f"""
        SELECT plant_id, plant_name, line_id, line_name, machine_type,
               CAST(failure_risk_score AS DOUBLE) AS failure_risk_score,
               CAST(downtime_exposure_usd AS DOUBLE) AS downtime_exposure_usd,
               CAST(utilization_pct AS DOUBLE) AS utilization_pct,
               risk_band, current_status,
               CAST(open_wo_count AS INT) AS open_wo_count,
               has_open_corrective, part_local,
               CAST(plant_lat AS DOUBLE) AS lat,
               CAST(plant_lng AS DOUBLE) AS lon
        FROM {FQ}.gold_line_status
        ORDER BY downtime_exposure_usd DESC
        """
    )


@app.get("/api/health", operation_id="getHealth")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "framework": "FastAPI + React",
        "catalog": CATALOG,
        "schema": SCHEMA,
        "warehouseConfigured": bool(WAREHOUSE_ID),
        "genieConfigured": bool(GENIE_SPACE_ID),
    }


@app.get("/api/fleet", operation_id="listFleet")
async def list_fleet() -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(fleet_query)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/summary", operation_id="getFleetSummary")
async def get_summary() -> dict[str, Any]:
    try:
        rows = await run_in_threadpool(fleet_query)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    def number(row: dict[str, Any], key: str) -> float:
        try:
            return float(row.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    return {
        "totalLines": len(rows),
        "atRiskLines": sum(
            row.get("risk_band") in {"critical", "elevated", "watch"} for row in rows
        ),
        "criticalLines": sum(row.get("risk_band") == "critical" for row in rows),
        "downtimeExposureUsd": sum(number(row, "downtime_exposure_usd") for row in rows),
        "openWorkOrders": sum(int(number(row, "open_wo_count")) for row in rows),
    }


@app.get("/api/recommendations/{line_id}", operation_id="getRecommendation")
async def get_recommendation(line_id: str) -> dict[str, Any]:
    safe_line_id = line_id.replace("'", "''")
    try:
        rows = await run_in_threadpool(
            execute_sql,
            f"""
            SELECT line_id, recommended_action,
                   CAST(predicted_net_value_usd AS DOUBLE) AS predicted_net_value_usd,
                   action_ranking
            FROM {FQ}.gold_maintenance_recommendations
            WHERE line_id = '{safe_line_id}'
            LIMIT 1
            """,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"No recommendation for {line_id}")

    result = rows[0]
    ranking = result.get("action_ranking")
    if isinstance(ranking, str):
        try:
            result["action_ranking"] = json.loads(ranking)
        except json.JSONDecodeError:
            result["action_ranking"] = []
    return result


def ask_genie(question: str) -> dict[str, Any]:
    if not GENIE_SPACE_ID:
        raise RuntimeError("GENIE_SPACE_ID is not configured")

    client = workspace_client()
    message = client.genie.start_conversation_and_wait(GENIE_SPACE_ID, question)
    text_parts: list[str] = []
    tables: list[dict[str, Any]] = []

    for attachment in message.attachments or []:
        if getattr(attachment, "text", None) and attachment.text.content:
            text_parts.append(attachment.text.content)
        query = getattr(attachment, "query", None)
        if not query:
            continue
        if getattr(query, "description", None):
            text_parts.append(query.description)
        try:
            result = client.genie.get_message_query_result(
                GENIE_SPACE_ID, message.conversation_id, message.id
            )
            statement = result.statement_response
            if statement and statement.result and statement.result.data_array:
                columns = [column.name for column in statement.manifest.schema.columns]
                rows = [
                    [json_value(value) for value in row]
                    for row in statement.result.data_array
                ]
                tables.append({"columns": columns, "rows": rows})
        except Exception:
            if getattr(query, "query", None):
                text_parts.append(f"```sql\n{query.query}\n```")

    if not text_parts and getattr(message, "content", None):
        text_parts.append(str(message.content))
    return {
        "answer": "\n\n".join(text_parts) or "Genie returned no text response.",
        "tables": tables,
        "conversationId": message.conversation_id,
    }


@app.post("/api/genie", operation_id="askGenie")
async def genie(request: GenieRequest) -> dict[str, Any]:
    try:
        return await run_in_threadpool(ask_genie, request.question)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def react_app(path: str) -> FileResponse:
        candidate = (FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
