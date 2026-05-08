#!/usr/bin/env python3
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "alerts.db"
SNAPSHOT_ROOT = DATA_DIR / "snapshots"

COLUMNS = {
    "created_at_ms": "INTEGER",
    "camera_label": "TEXT",
    "category": "TEXT NOT NULL DEFAULT 'safety'",
    "category_cn": "TEXT NOT NULL DEFAULT ''",
    "alert_type": "TEXT NOT NULL DEFAULT ''",
    "title": "TEXT NOT NULL DEFAULT ''",
    "message": "TEXT",
    "model_name": "TEXT",
    "skill_id": "TEXT",
    "snapshot_path": "TEXT",
    "video_path": "TEXT",
    "source_skill": "TEXT",
    "reviewed_by_qwen": "INTEGER DEFAULT 0",
    "qwen_result": "TEXT",
    "raw_json": "TEXT",
}


def safe_name(value, fallback):
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(value or fallback))
    cleaned = cleaned[:80].strip("._")
    return cleaned or fallback


def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          created_at_ms INTEGER,
          camera_id TEXT NOT NULL,
          camera_label TEXT,
          category TEXT NOT NULL DEFAULT 'safety',
          category_cn TEXT NOT NULL DEFAULT '',
          alert_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL,
          confidence REAL,
          model_name TEXT,
          skill_id TEXT,
          message TEXT,
          snapshot_path TEXT,
          video_path TEXT,
          source_skill TEXT,
          reviewed_by_qwen INTEGER DEFAULT 0,
          qwen_result TEXT,
          raw_json TEXT
        )
        """
    )
    existing = {row[1] for row in conn.execute("PRAGMA table_info(alerts)")}
    for name, ddl in COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE alerts ADD COLUMN {name} {ddl}")


def unique_snapshot_path(now):
    camera_id = safe_name("test-cam", "test-cam")
    alert_type = safe_name("no-helmet", "no-helmet")
    day_dir = SNAPSHOT_ROOT / now.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{camera_id}_{alert_type}_{now.strftime('%H%M%S')}"
    candidate = day_dir / f"{base_name}.jpg"
    if candidate.exists():
        candidate = day_dir / f"{base_name}_{now.strftime('%f')[:3]}.jpg"
    suffix = 1
    while candidate.exists():
        candidate = day_dir / f"{base_name}_{now.strftime('%f')[:3]}_{suffix}.jpg"
        suffix += 1
    resolved_root = SNAPSHOT_ROOT.resolve()
    resolved_candidate = candidate.resolve()
    if resolved_candidate != resolved_root and resolved_root not in resolved_candidate.parents:
        raise RuntimeError("Snapshot path escaped data/snapshots")
    try:
        from PIL import Image

        image = Image.new("RGB", (1, 1), color=(180, 30, 30))
        image.save(candidate, format="JPEG", quality=80)
    except Exception:
        # Fallback to a tiny valid PNG if Pillow is unavailable.
        candidate = candidate.with_suffix(".png")
        candidate.write_bytes(
            bytes.fromhex(
                "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
                "0000000d49444154789c6360f8ffff3f0005fe02fea73581e80000000049454e44ae426082"
            )
        )
    return candidate.relative_to(PROJECT_ROOT).as_posix()


def main():
    now = datetime.now(timezone.utc)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_path = unique_snapshot_path(now)
    raw = {
        "alert": {
            "type": "no-helmet",
            "title": "未戴安全帽",
            "severity": "warning",
            "confidence": 0.88,
            "snapshotPath": snapshot_path,
            "eventSource": "round6-test",
        },
        "detections": [
            {
                "label": "no-helmet",
                "name": "未戴安全帽",
                "confidence": 0.88,
                "bbox": [1, 1, 10, 10],
            }
        ],
        "meta": {"model": "test-model.pt", "skill": "yolo-safety"},
        "camera": {"id": "test-cam", "label": "测试摄像头"},
        "timestamp": int(now.timestamp() * 1000),
    }

    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(conn)
        cursor = conn.execute(
            """
            INSERT INTO alerts (
              created_at, created_at_ms, camera_id, camera_label,
              category, category_cn, alert_type, title, severity, confidence,
              model_name, skill_id, message, snapshot_path, video_path,
              source_skill, reviewed_by_qwen, qwen_result, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                int(now.timestamp() * 1000),
                "test-cam",
                "测试摄像头",
                "ppe",
                "未戴安全帽",
                "no-helmet",
                "未戴安全帽",
                "warning",
                0.88,
                "test-model.pt",
                "yolo-safety",
                "Round6 test alert",
                snapshot_path,
                None,
                "yolo-safety",
                0,
                None,
                json.dumps(raw, ensure_ascii=False, sort_keys=True),
            ),
        )
        conn.commit()
        alert_id = cursor.lastrowid
    finally:
        conn.close()

    print(json.dumps({"success": True, "id": alert_id, "snapshot_path": snapshot_path}, ensure_ascii=False))


if __name__ == "__main__":
    main()
