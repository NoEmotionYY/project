import importlib.util
import json
import os
import sqlite3
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_PATH = ROOT / "skills" / "yolo-safety.py"


def load_skill():
    spec = importlib.util.spec_from_file_location("yolo_safety_skill", SKILL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DummyImage:
    def save(self, path, format=None, quality=None):
        Path(path).write_bytes(b"dummy-jpeg")


def detection(label, confidence=0.9):
    return {
        "label": label,
        "name": label,
        "confidence": confidence,
        "bbox": [1, 2, 3, 4],
        "severity": "warning",
    }


def test_no_helmet_confirmation_and_cooldown(skill):
    config = skill.build_config({
        "confirmCounts": {"no-helmet": 3},
        "cooldowns": {"no-helmet": 5},
    })
    gov = skill.AlertGovernance()

    assert gov.observe("cam-1", [detection("no-helmet")], 100.0, config) == []
    assert gov.observe("cam-1", [detection("no-helmet")], 101.0, config) == []
    alerts = gov.observe("cam-1", [detection("no-helmet")], 102.0, config)
    assert len(alerts) == 1
    assert alerts[0]["type"] == "no-helmet"

    assert gov.observe("cam-1", [detection("no-helmet")], 103.0, config) == []
    assert len(gov.observe("cam-1", [detection("no-helmet")], 108.0, config)) == 1


def test_config_confirm_frames_alias_from_server_context(skill):
    config = skill.build_config({
        "confirmFrames": {"no-helmet": 2, "fire": 4},
        "thresholds": {"no-helmet": 0.7},
        "modelProfile": "ppe",
        "qwenReview": True,
    })
    assert config["confirmCounts"]["no-helmet"] == 2
    assert config["confirmCounts"]["fire"] == 4
    assert config["thresholds"]["no-helmet"] == 0.7
    assert config["modelProfile"] == "ppe"
    assert config["qwenReview"] is True


def test_fire_and_smoke_confirmation_are_independent(skill):
    config = skill.build_config({
        "confirmCounts": {"fire": 2, "smoke": 2},
        "cooldowns": {"fire": 10, "smoke": 10},
    })
    gov = skill.AlertGovernance()

    assert gov.observe("cam-1", [detection("fire")], 200.0, config) == []
    assert [a["type"] for a in gov.observe("cam-1", [detection("fire")], 201.0, config)] == ["fire"]
    assert gov.observe("cam-1", [detection("smoke")], 202.0, config) == []
    assert [a["type"] for a in gov.observe("cam-1", [detection("smoke")], 203.0, config)] == ["smoke"]


def test_helmet_and_vest_do_not_alert(skill):
    config = skill.build_config()
    gov = skill.AlertGovernance()
    alerts = gov.observe("cam-1", [detection("helmet"), detection("vest")], 300.0, config)
    assert alerts == []


def test_snapshot_path_is_sanitized(skill):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        snapshot_root = Path(tmp) / "snapshots"
        rel_path = skill.save_snapshot(DummyImage(), "../bad/cam", "no-helmet", 1710000000000, snapshot_root)
        assert ".." not in rel_path
        assert "/" not in Path(rel_path).name
        files = list(snapshot_root.rglob("*.jpg"))
        assert len(files) == 1
        assert snapshot_root.resolve() in files[0].resolve().parents
        expected_day = skill.timestamp_ms_to_datetime(1710000000000)
        relative_parts = files[0].relative_to(snapshot_root).parts
        assert relative_parts[0] == expected_day.strftime("%Y-%m-%d")
        assert relative_parts[1].startswith(f"cam_no-helmet_{expected_day.strftime('%H%M%S')}")
        assert relative_parts[1].endswith(".jpg")
        assert skill.SNAPSHOT_ROOT == skill.PROJECT_ROOT / "data" / "snapshots"

        try:
            skill.resolve_inside(snapshot_root, "..", "escape.jpg")
            raise AssertionError("path traversal was not blocked")
        except ValueError:
            pass


def test_sqlite_event_uses_controlled_path(skill):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        db_path = Path(tmp) / "data" / "alerts.db"
        alert = {
            "cameraId": "cam-1",
            "type": "fire",
            "title": "fire",
            "severity": "critical",
            "confidence": 0.95,
            "snapshotPath": "data/snapshots/2024-03-10/cam-1_fire_003421.jpg",
            "videoPath": "recordings/cam-1/clip.mkv",
            "cameraLabel": "Front Gate",
            "category": "hazard",
            "categoryCn": "火灾",
            "modelName": "models/yolo-safety.pt",
            "skillId": "yolo-safety",
            "message": "confirmed fire",
            "reviewedByQwen": False,
        }
        event_id = skill.insert_alert_event(
            alert,
            1710000000000,
            db_path,
            raw_event={
                "alert": alert,
                "detections": [],
                "meta": {"model": "models/yolo-safety.pt"},
                "camera": {"id": "cam-1", "label": "Front Gate"},
            },
        )
        assert event_id == 1
        assert db_path.exists()
        with sqlite3.connect(db_path) as conn:
            rows = conn.execute(
                """
                SELECT camera_id, camera_label, category, category_cn, alert_type,
                  model_name, skill_id, video_path, raw_json
                FROM alerts
                """
            ).fetchall()
            columns = {row[1] for row in conn.execute("PRAGMA table_info(alerts)").fetchall()}
        assert rows[0][:8] == (
            "cam-1",
            "Front Gate",
            "hazard",
            "火灾",
            "fire",
            "models/yolo-safety.pt",
            "yolo-safety",
            "recordings/cam-1/clip.mkv",
        )
        raw_json = json.loads(rows[0][8])
        assert raw_json["alert"]["type"] == "fire"
        assert raw_json["meta"]["model"] == "models/yolo-safety.pt"
        assert raw_json["camera"]["id"] == "cam-1"
        assert {
            "created_at_ms",
            "category_cn",
            "model_name",
            "skill_id",
            "message",
            "snapshot_path",
            "source_skill",
            "raw_json",
        }.issubset(columns)
        assert skill.ALERT_DB_PATH == skill.PROJECT_ROOT / "data" / "alerts.db"


def test_existing_alert_table_is_migrated(skill):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        db_path = Path(tmp) / "data" / "alerts.db"
        db_path.parent.mkdir(parents=True)
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE alerts(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  camera_id TEXT NOT NULL,
                  alert_type TEXT NOT NULL,
                  title TEXT NOT NULL,
                  severity TEXT NOT NULL,
                  confidence REAL,
                  snapshot_path TEXT,
                  reviewed_by_qwen INTEGER DEFAULT 0,
                  qwen_result TEXT,
                  created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

        skill.ensure_alert_table(db_path)
        with sqlite3.connect(db_path) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(alerts)").fetchall()}
        assert {
            "camera_label",
            "category",
            "category_cn",
            "model_name",
            "skill_id",
            "video_path",
            "raw_json",
            "created_at_ms",
        }.issubset(columns)


def test_result_json_and_qwen_review_flag_do_not_require_key(skill):
    old_qwen = os.environ.pop("QWEN_API_KEY", None)
    old_dash = os.environ.pop("DASHSCOPE_API_KEY", None)
    try:
        alerts = [{
            "type": "fire",
            "title": "fire",
            "severity": "critical",
            "confidence": 0.9,
            "cameraId": "cam-1",
            "snapshotPath": "",
            "eventId": None,
            "confirmed": True,
            "reviewedByQwen": False,
            "needsReview": False,
            "reviewReason": "",
            "message": "confirmed fire",
        }]
        config = skill.build_config({"qwenReview": True})
        skill.mark_qwen_review(alerts, config)
        assert alerts[0]["needsReview"] is False

        os.environ["QWEN_API_KEY"] = "test-key"
        skill.mark_qwen_review(alerts, config)
        assert alerts[0]["needsReview"] is True

        result = skill.build_result("cam-1", 1710000000000, [], alerts, {"qwenReviewed": False})
        parsed = json.loads(json.dumps(result, ensure_ascii=False))
        assert parsed["success"] is True
        assert parsed["skill"] == "yolo-safety"
        assert parsed["alerts"][0]["type"] == "fire"
    finally:
        if old_qwen is not None:
            os.environ["QWEN_API_KEY"] = old_qwen
        else:
            os.environ.pop("QWEN_API_KEY", None)
        if old_dash is not None:
            os.environ["DASHSCOPE_API_KEY"] = old_dash
        else:
            os.environ.pop("DASHSCOPE_API_KEY", None)


def run():
    skill = load_skill()
    tests = [
        test_no_helmet_confirmation_and_cooldown,
        test_config_confirm_frames_alias_from_server_context,
        test_fire_and_smoke_confirmation_are_independent,
        test_helmet_and_vest_do_not_alert,
        test_snapshot_path_is_sanitized,
        test_sqlite_event_uses_controlled_path,
        test_existing_alert_table_is_migrated,
        test_result_json_and_qwen_review_flag_do_not_require_key,
    ]
    for test in tests:
        test(skill)
        print(f"ok - {test.__name__}")


if __name__ == "__main__":
    run()
