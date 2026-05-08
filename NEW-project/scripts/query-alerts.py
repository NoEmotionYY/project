#!/usr/bin/env python3
import json
import sqlite3
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "alerts.db"

LIST_COLUMNS = [
    "id",
    "created_at",
    "created_at_ms",
    "camera_id",
    "camera_label",
    "category",
    "category_cn",
    "alert_type",
    "title",
    "severity",
    "confidence",
    "model_name",
    "skill_id",
    "message",
    "snapshot_path",
    "video_path",
    "source_skill",
    "reviewed_by_qwen",
    "qwen_result",
]

DETAIL_COLUMNS = LIST_COLUMNS + ["raw_json"]


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def row_to_dict(row, columns):
    return {columns[index]: row[index] for index in range(len(columns))}


def positive_int(value, default, minimum=1, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if parsed < minimum:
        parsed = default
    if maximum is not None and parsed > maximum:
        parsed = maximum
    return parsed


def build_where(query):
    clauses = []
    params = []

    camera_id = query.get("camera_id")
    if camera_id:
        clauses.append("camera_id = ?")
        params.append(str(camera_id))

    category = query.get("category")
    if category:
        clauses.append("(category = ? OR alert_type = ? OR category_cn = ?)")
        category_value = str(category)
        params.extend([category_value, category_value, category_value])

    severity = query.get("severity")
    if severity:
        clauses.append("severity = ?")
        params.append(str(severity))

    start = query.get("start")
    if start:
        clauses.append("created_at >= ?")
        params.append(str(start))

    end = query.get("end")
    if end:
        clauses.append("created_at <= ?")
        params.append(str(end))

    keyword = query.get("q")
    if keyword:
        like_value = f"%{str(keyword)}%"
        clauses.append(
            "("
            "camera_id LIKE ? OR camera_label LIKE ? OR category LIKE ? OR "
            "category_cn LIKE ? OR alert_type LIKE ? OR title LIKE ? OR "
            "severity LIKE ? OR message LIKE ? OR model_name LIKE ? OR skill_id LIKE ?"
            ")"
        )
        params.extend([like_value] * 10)

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def connect_readonly():
    if not DB_PATH.exists():
        return None
    return sqlite3.connect(f"{DB_PATH.resolve().as_uri()}?mode=ro", uri=True)


def list_alerts(query):
    page = positive_int(query.get("page"), 1, minimum=1)
    limit = positive_int(query.get("limit"), 50, minimum=1, maximum=200)
    sort = "ASC" if str(query.get("sort", "desc")).lower() == "asc" else "DESC"

    conn = connect_readonly()
    if conn is None:
        return {"success": True, "page": page, "limit": limit, "total": 0, "items": []}

    where_sql, params = build_where(query)
    offset = (page - 1) * limit
    columns_sql = ", ".join(LIST_COLUMNS)
    try:
        with conn:
            total = conn.execute(f"SELECT COUNT(*) FROM alerts{where_sql}", params).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT {columns_sql}
                FROM alerts
                {where_sql}
                ORDER BY created_at {sort}, id {sort}
                LIMIT ? OFFSET ?
                """,
                params + [limit, offset],
            ).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            conn.close()
            return {"success": True, "page": page, "limit": limit, "total": 0, "items": []}
        raise
    conn.close()

    return {
        "success": True,
        "page": page,
        "limit": limit,
        "total": total,
        "items": [row_to_dict(row, LIST_COLUMNS) for row in rows],
    }


def detail_alert(alert_id):
    conn = connect_readonly()
    if conn is None:
        return {"success": False, "notFound": True, "error": "Alert not found"}

    columns_sql = ", ".join(DETAIL_COLUMNS)
    try:
        with conn:
            row = conn.execute(
                f"SELECT {columns_sql} FROM alerts WHERE id = ?",
                [alert_id],
            ).fetchone()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            conn.close()
            return {"success": False, "notFound": True, "error": "Alert not found"}
        raise
    conn.close()

    if row is None:
        return {"success": False, "notFound": True, "error": "Alert not found"}

    item = row_to_dict(row, DETAIL_COLUMNS)
    raw_json = item.get("raw_json")
    if raw_json:
        try:
            item["raw"] = json.loads(raw_json)
        except (TypeError, ValueError):
            pass
    return {"success": True, "item": item}


def snapshot_path(alert_id):
    conn = connect_readonly()
    if conn is None:
        return {"success": False, "notFound": True, "error": "Alert not found"}

    try:
        with conn:
            row = conn.execute(
                "SELECT id, snapshot_path FROM alerts WHERE id = ?",
                [alert_id],
            ).fetchone()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            conn.close()
            return {"success": False, "notFound": True, "error": "Snapshot not found"}
        raise
    conn.close()

    if row is None or not row[1]:
        return {"success": False, "notFound": True, "error": "Snapshot not found"}
    return {"success": True, "id": row[0], "snapshot_path": row[1]}


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        action = payload.get("action")
        if action == "list":
            emit(list_alerts(payload.get("query") or {}))
        elif action == "detail":
            alert_id = positive_int(payload.get("id"), 0, minimum=1)
            if not alert_id:
                emit({"success": False, "error": "Invalid alert id"})
            else:
                emit(detail_alert(alert_id))
        elif action == "snapshot":
            alert_id = positive_int(payload.get("id"), 0, minimum=1)
            if not alert_id:
                emit({"success": False, "error": "Invalid alert id"})
            else:
                emit(snapshot_path(alert_id))
        else:
            emit({"success": False, "error": "Unsupported alert query action"})
    except Exception as exc:
        print(f"[query-alerts] {exc}", file=sys.stderr, flush=True)
        emit({"success": False, "error": str(exc)})


if __name__ == "__main__":
    main()
