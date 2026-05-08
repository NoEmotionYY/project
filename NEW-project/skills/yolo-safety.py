# @name: yolo-safety
# @label: YOLO safety governance
# @description: Local YOLO screening with alert governance and optional Qwen review flags
# @persistent: true

import base64
import binascii
import io
import json
import os
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional runtime dependency check
    Image = None

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover - tests do not need YOLO installed
    YOLO = None


SKILL_NAME = "yolo-safety"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_ROOT = PROJECT_ROOT / "data" / "snapshots"
ALERT_DB_PATH = PROJECT_ROOT / "data" / "alerts.db"

ALERT_TYPE_ORDER = ("no-helmet", "no-vest", "fire", "smoke")
ALERT_TYPES = set(ALERT_TYPE_ORDER)
QWEN_REVIEW_TYPES = {"fire", "smoke"}
LOW_CONF_REVIEW_MAX = 0.70

DISPLAY_NAMES = {
    "helmet": "安全帽",
    "vest": "反光衣",
    "no-helmet": "未戴安全帽",
    "no-vest": "未穿反光衣",
    "fire": "火灾",
    "smoke": "烟雾",
}

SEVERITY = {
    "helmet": "info",
    "vest": "info",
    "no-helmet": "warning",
    "no-vest": "warning",
    "fire": "critical",
    "smoke": "critical",
}

LABEL_ALIASES = {
    "helmet": "helmet",
    "hardhat": "helmet",
    "hat": "helmet",
    "safety-helmet": "helmet",
    "vest": "vest",
    "safety-vest": "vest",
    "reflective-vest": "vest",
    "no-helmet": "no-helmet",
    "no-hardhat": "no-helmet",
    "none-helmet": "no-helmet",
    "without-helmet": "no-helmet",
    "no-vest": "no-vest",
    "none-vest": "no-vest",
    "without-vest": "no-vest",
    "fire": "fire",
    "flame": "fire",
    "smoke": "smoke",
}

DEFAULT_THRESHOLDS = {
    "helmet": 0.35,
    "vest": 0.35,
    "no-helmet": 0.55,
    "no-vest": 0.55,
    "fire": 0.50,
    "smoke": 0.50,
}

DEFAULT_CONFIRM_COUNTS = {
    "no-helmet": 3,
    "no-vest": 3,
    "fire": 2,
    "smoke": 2,
}

DEFAULT_COOLDOWNS = {
    "no-helmet": 5.0,
    "no-vest": 5.0,
    "fire": 10.0,
    "smoke": 10.0,
}

MODEL_PROFILES = ("default", "ppe", "fire")
_MODEL_CACHE = {}
_FALLBACK_LOGGED = False

ALERT_TABLE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "created_at": "TEXT NOT NULL",
    "created_at_ms": "INTEGER",
    "camera_id": "TEXT NOT NULL",
    "camera_label": "TEXT",
    "category": "TEXT NOT NULL DEFAULT 'safety'",
    "category_cn": "TEXT NOT NULL DEFAULT ''",
    "alert_type": "TEXT NOT NULL",
    "title": "TEXT NOT NULL",
    "severity": "TEXT NOT NULL",
    "confidence": "REAL",
    "model_name": "TEXT",
    "skill_id": "TEXT",
    "message": "TEXT",
    "snapshot_path": "TEXT",
    "video_path": "TEXT",
    "source_skill": "TEXT",
    "reviewed_by_qwen": "INTEGER DEFAULT 0",
    "qwen_result": "TEXT",
    "raw_json": "TEXT",
}

ALERT_TABLE_ALTER_COLUMNS = {
    **ALERT_TABLE_COLUMNS,
    "created_at": "TEXT",
    "camera_id": "TEXT",
    "alert_type": "TEXT",
    "title": "TEXT",
    "severity": "TEXT",
}


def log(message):
    print(f"[{SKILL_NAME}] {message}", file=sys.stderr, flush=True)


def parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def build_config(overrides=None):
    default_conf = env_float("CYPHER_YOLO_CONF_DEFAULT", DEFAULT_THRESHOLDS["helmet"])
    config = {
        "thresholds": {
            "helmet": default_conf,
            "vest": default_conf,
            "no-helmet": env_float("CYPHER_YOLO_CONF_NO_HELMET", DEFAULT_THRESHOLDS["no-helmet"]),
            "no-vest": env_float("CYPHER_YOLO_CONF_NO_VEST", DEFAULT_THRESHOLDS["no-vest"]),
            "fire": env_float("CYPHER_YOLO_CONF_FIRE", DEFAULT_THRESHOLDS["fire"]),
            "smoke": env_float("CYPHER_YOLO_CONF_SMOKE", DEFAULT_THRESHOLDS["smoke"]),
        },
        "confirmCounts": {
            "no-helmet": env_int("CYPHER_ALERT_CONFIRM_NO_HELMET", DEFAULT_CONFIRM_COUNTS["no-helmet"]),
            "no-vest": env_int("CYPHER_ALERT_CONFIRM_NO_VEST", DEFAULT_CONFIRM_COUNTS["no-vest"]),
            "fire": env_int("CYPHER_ALERT_CONFIRM_FIRE", DEFAULT_CONFIRM_COUNTS["fire"]),
            "smoke": env_int("CYPHER_ALERT_CONFIRM_SMOKE", DEFAULT_CONFIRM_COUNTS["smoke"]),
        },
        "cooldowns": {
            "no-helmet": env_float("CYPHER_ALERT_COOLDOWN_SECONDS", DEFAULT_COOLDOWNS["no-helmet"]),
            "no-vest": env_float("CYPHER_ALERT_COOLDOWN_SECONDS", DEFAULT_COOLDOWNS["no-vest"]),
            "fire": env_float("CYPHER_FIRE_ALERT_COOLDOWN_SECONDS", DEFAULT_COOLDOWNS["fire"]),
            "smoke": env_float("CYPHER_FIRE_ALERT_COOLDOWN_SECONDS", DEFAULT_COOLDOWNS["smoke"]),
        },
        "qwenReview": parse_bool(os.environ.get("CYPHER_ENABLE_QWEN_REVIEW"), False),
        "modelProfile": "default",
    }

    if isinstance(overrides, dict):
        if overrides.get("modelProfile") in MODEL_PROFILES:
            config["modelProfile"] = overrides["modelProfile"]
        if "qwenReview" in overrides:
            config["qwenReview"] = bool(overrides["qwenReview"])
        if isinstance(overrides.get("thresholds"), dict):
            for key, value in overrides["thresholds"].items():
                if key in config["thresholds"]:
                    try:
                        config["thresholds"][key] = float(value)
                    except (TypeError, ValueError):
                        pass
        confirm_overrides = overrides.get("confirmFrames")
        if not isinstance(confirm_overrides, dict):
            confirm_overrides = overrides.get("confirmCounts")
        if isinstance(confirm_overrides, dict):
            for key, value in confirm_overrides.items():
                if key in config["confirmCounts"]:
                    try:
                        config["confirmCounts"][key] = max(1, int(value))
                    except (TypeError, ValueError):
                        pass
        if isinstance(overrides.get("cooldowns"), dict):
            for key, value in overrides["cooldowns"].items():
                if key in config["cooldowns"]:
                    try:
                        config["cooldowns"][key] = max(0.0, float(value))
                    except (TypeError, ValueError):
                        pass

    return config


def safe_name(value, fallback="default"):
    fallback = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(fallback or "default"))
    fallback = fallback or "default"
    base = os.path.basename(str(value or fallback))
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in base)[:80]
    if not cleaned or cleaned in {".", ".."}:
        return fallback
    return cleaned


def resolve_inside(base_dir, *parts):
    base = Path(base_dir).resolve()
    target = base.joinpath(*map(str, parts)).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Path traversal blocked")
    return target


def project_relative(path):
    try:
        return Path(path).resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return Path(path).name


def safe_text(value, max_len=240):
    text = str(value or "").replace("\x00", "").strip()
    return text[:max_len]


def alert_category(alert_type):
    if alert_type in {"no-helmet", "no-vest"}:
        return "ppe"
    if alert_type in {"fire", "smoke"}:
        return "hazard"
    return "safety"


def alert_category_cn(alert_type):
    return DISPLAY_NAMES.get(alert_type, safe_text(alert_type) or "未知")


def normalize_label(raw_label):
    normalized = str(raw_label or "").strip().lower().replace("_", "-").replace(" ", "-")
    return LABEL_ALIASES.get(normalized)


def timestamp_ms_to_datetime(timestamp_ms):
    try:
        ts = float(timestamp_ms) / 1000.0
    except (TypeError, ValueError):
        ts = time.time()
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone()


def resolve_model_candidates(profile):
    env_by_profile = {
        "default": "CYPHER_YOLO_MODEL",
        "ppe": "CYPHER_YOLO_PPE_MODEL",
        "fire": "CYPHER_YOLO_FIRE_MODEL",
    }
    candidates = []
    profile_env = os.environ.get(env_by_profile.get(profile, "CYPHER_YOLO_MODEL"), "").strip()
    generic_env = os.environ.get("CYPHER_YOLO_MODEL", "").strip()
    for raw in (profile_env, generic_env):
        if raw and raw not in candidates:
            candidates.append(raw)

    if profile == "fire":
        candidates.append("models/yolo-fire.pt")
    candidates.extend(["models/yolo-safety.pt", "skills/best.pt", "yolov8n.pt"])
    return candidates


def normalize_model_path(raw_path):
    path = Path(raw_path)
    if raw_path == "yolov8n.pt":
        return raw_path
    if path.is_absolute():
        return str(path)
    return str((PROJECT_ROOT / path).resolve())


def choose_model_path(profile):
    global _FALLBACK_LOGGED
    for candidate in resolve_model_candidates(profile):
        normalized = normalize_model_path(candidate)
        if candidate == "yolov8n.pt":
            if not _FALLBACK_LOGGED:
                log("falling back to yolov8n.pt for development only; PPE/fire class accuracy is not guaranteed")
                _FALLBACK_LOGGED = True
            return normalized
        if Path(normalized).exists():
            return normalized
    return "yolov8n.pt"


def get_model(profile):
    if YOLO is None:
        raise RuntimeError("ultralytics is not available. Install requirements.txt for YOLO support.")
    profile = profile if profile in MODEL_PROFILES else "default"
    model_path = choose_model_path(profile)
    if model_path not in _MODEL_CACHE:
        log(f"loading YOLO model: {model_path}")
        _MODEL_CACHE[model_path] = YOLO(model_path)
    return _MODEL_CACHE[model_path], model_path


def decode_image_payload(request):
    if Image is None:
        raise RuntimeError("Pillow is not available. Install requirements.txt for image decoding.")

    image_b64 = request.get("image") or request.get("imageBase64") or ""
    if image_b64:
        try:
            image_bytes = base64.b64decode(image_b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64 image payload") from exc
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")

    frame_path = request.get("framePath")
    if frame_path:
        safe_path = resolve_inside(PROJECT_ROOT, frame_path)
        return Image.open(safe_path).convert("RGB")

    raise ValueError("Missing image or framePath")


def extract_detections(results, model, config):
    detections = []
    if not results:
        return detections

    boxes = getattr(results[0], "boxes", None)
    names = getattr(model, "names", {}) or {}
    if boxes is None:
        return detections

    for box in boxes:
        try:
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            label = normalize_label(names.get(cls_id, str(cls_id)))
            if not label:
                continue
            threshold = config["thresholds"].get(label, DEFAULT_THRESHOLDS.get(label, 0.35))
            if confidence < threshold:
                continue
            bbox = [int(v) for v in box.xyxy[0].tolist()]
        except Exception:
            continue

        detections.append({
            "label": label,
            "name": DISPLAY_NAMES[label],
            "confidence": round(confidence, 4),
            "bbox": bbox,
            "severity": SEVERITY[label],
        })

    return detections


class AlertGovernance:
    def __init__(self):
        self._state = {}

    def reset(self):
        self._state.clear()

    def observe(self, camera_id, detections, now, config):
        alerts = []
        by_type = {}
        for detection in detections:
            label = detection.get("label")
            if label not in ALERT_TYPES:
                continue
            current = by_type.get(label)
            if current is None or detection.get("confidence", 0) > current.get("confidence", 0):
                by_type[label] = detection

        for alert_type in ALERT_TYPE_ORDER:
            state_key = (camera_id, alert_type)
            state = self._state.setdefault(state_key, {"count": 0, "lastAlertAt": 0.0})
            detection = by_type.get(alert_type)
            if not detection:
                state["count"] = 0
                continue

            state["count"] += 1
            required = max(1, int(config["confirmCounts"].get(alert_type, DEFAULT_CONFIRM_COUNTS[alert_type])))
            cooldown = max(0.0, float(config["cooldowns"].get(alert_type, DEFAULT_COOLDOWNS[alert_type])))
            confirmed = state["count"] >= required
            cooled = (now - state["lastAlertAt"]) >= cooldown
            if not confirmed or not cooled:
                continue

            state["lastAlertAt"] = now
            alerts.append({
                "type": alert_type,
                "category": alert_category(alert_type),
                "categoryCn": alert_category_cn(alert_type),
                "title": DISPLAY_NAMES[alert_type],
                "severity": SEVERITY[alert_type],
                "confidence": detection.get("confidence", 0),
                "cameraId": camera_id,
                "cameraLabel": "",
                "modelName": "",
                "skillId": SKILL_NAME,
                "snapshotPath": "",
                "videoPath": "",
                "eventId": None,
                "confirmed": True,
                "reviewedByQwen": False,
                "needsReview": False,
                "reviewReason": "",
                "message": f"连续 {required} 帧检测到{DISPLAY_NAMES[alert_type]}",
            })

        return alerts


GOVERNANCE = AlertGovernance()


def save_snapshot(image, camera_id, alert_type, timestamp_ms, snapshot_root=SNAPSHOT_ROOT):
    when = timestamp_ms_to_datetime(timestamp_ms)
    day_dir = resolve_inside(snapshot_root, when.strftime("%Y-%m-%d"))
    day_dir.mkdir(parents=True, exist_ok=True)

    safe_camera = safe_name(camera_id, "cam")
    safe_alert = safe_name(alert_type, "alert")
    base_time = when.strftime("%H%M%S")
    file_name = safe_name(f"{safe_camera}_{safe_alert}_{base_time}.jpg", "alert.jpg")
    snapshot_path = resolve_inside(day_dir, file_name)
    if snapshot_path.exists():
        millis = int(when.microsecond / 1000)
        file_name = safe_name(f"{safe_camera}_{safe_alert}_{base_time}_{millis:03d}.jpg", "alert.jpg")
        snapshot_path = resolve_inside(day_dir, file_name)
        suffix = 1
        while snapshot_path.exists():
            file_name = safe_name(f"{safe_camera}_{safe_alert}_{base_time}_{millis:03d}_{suffix}.jpg", "alert.jpg")
            snapshot_path = resolve_inside(day_dir, file_name)
            suffix += 1

    image.save(snapshot_path, format="JPEG", quality=88)
    return project_relative(snapshot_path)


def ensure_alert_table(db_path=ALERT_DB_PATH):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              created_at_ms INTEGER,
              camera_id TEXT NOT NULL,
              camera_label TEXT,
              category TEXT NOT NULL DEFAULT 'safety',
              category_cn TEXT NOT NULL DEFAULT '',
              alert_type TEXT NOT NULL,
              title TEXT NOT NULL,
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
        existing = {row[1] for row in conn.execute("PRAGMA table_info(alerts)").fetchall()}
        for column, definition in ALERT_TABLE_COLUMNS.items():
            if column == "id" or column in existing:
                continue
            conn.execute(f"ALTER TABLE alerts ADD COLUMN {column} {ALERT_TABLE_ALTER_COLUMNS[column]}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alerts_camera_created ON alerts(camera_id, created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alerts_category_created ON alerts(category, created_at)")
        conn.commit()


def insert_alert_event(alert, timestamp_ms, db_path=ALERT_DB_PATH, raw_event=None):
    ensure_alert_table(db_path)
    created_at = timestamp_ms_to_datetime(timestamp_ms).isoformat()
    try:
        created_at_ms = int(float(timestamp_ms))
    except (TypeError, ValueError):
        created_at_ms = int(time.time() * 1000)
    raw_json = json.dumps(raw_event or alert, ensure_ascii=False, sort_keys=True)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO alerts(
              created_at, created_at_ms, camera_id, camera_label, category,
              category_cn, alert_type, title, severity, confidence,
              model_name, skill_id, message,
              snapshot_path, video_path, source_skill,
              reviewed_by_qwen, qwen_result, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                created_at_ms,
                safe_name(alert.get("cameraId") or "unknown", "unknown"),
                safe_text(alert.get("cameraLabel")),
                safe_text(alert.get("category") or alert_category(alert.get("type"))),
                safe_text(alert.get("categoryCn") or alert.get("category_cn") or alert_category_cn(alert.get("type"))),
                safe_text(alert.get("type")),
                safe_text(alert.get("title")),
                safe_text(alert.get("severity")),
                alert.get("confidence"),
                safe_text(alert.get("modelName") or alert.get("model_name")),
                safe_text(alert.get("skillId") or alert.get("skill_id") or alert.get("skill") or SKILL_NAME),
                safe_text(alert.get("message"), 1000),
                alert.get("snapshotPath") or None,
                alert.get("videoPath") or None,
                safe_text(alert.get("skill") or SKILL_NAME),
                1 if alert.get("reviewedByQwen") else 0,
                alert.get("qwenResult") or None,
                raw_json,
            ),
        )
        conn.commit()
        return cursor.lastrowid


def qwen_key_available():
    return bool(os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY"))


def mark_qwen_review(alerts, config):
    if not alerts or not config.get("qwenReview") or not qwen_key_available():
        return
    for alert in alerts:
        alert_type = alert.get("type")
        confidence = float(alert.get("confidence") or 0)
        if alert_type in QWEN_REVIEW_TYPES:
            alert["needsReview"] = True
            alert["reviewReason"] = f"{alert_type} confirmed by YOLO"
        elif alert_type in {"no-helmet", "no-vest"} and confidence < LOW_CONF_REVIEW_MAX:
            alert["needsReview"] = True
            alert["reviewReason"] = "low confidence PPE alert confirmed by YOLO"


def risk_level_for_alerts(alerts):
    if any(alert.get("severity") == "critical" for alert in alerts):
        return "high"
    if alerts:
        return "medium"
    return "none"


def build_text(detections, alerts):
    if alerts:
        return " | ".join(alert["message"] for alert in alerts)
    if detections:
        labels = ", ".join(sorted({item["name"] for item in detections}))
        return f"YOLO detected: {labels}; no confirmed alert"
    return "YOLO: no monitored safety risk detected"


def build_result(camera_id, timestamp_ms, detections, alerts, meta):
    alert_titles = [alert["title"] for alert in alerts]
    voice_texts = [alert["title"] for alert in alerts if alert["type"] in {"no-helmet", "no-vest"}]
    critical_alert = next((alert for alert in alerts if alert["severity"] == "critical"), None)
    beep_count = 0
    if critical_alert:
        beep_count = 3
    elif voice_texts:
        beep_count = 2

    return {
        "success": True,
        "skill": SKILL_NAME,
        "cameraId": camera_id,
        "timestamp": timestamp_ms,
        "detections": detections,
        "alerts": alerts,
        "meta": meta,
        "text": build_text(detections, alerts),
        "alert": bool(alerts),
        "alert_details": alert_titles,
        "voice_reminder": bool(voice_texts),
        "voice_text": "；".join(voice_texts),
        "voice_texts": voice_texts,
        "risk_level": risk_level_for_alerts(alerts),
        "cleanup_hint": "",
        "evacuate_reminder": bool(critical_alert),
        "evacuate_text": "请尽快离开" if critical_alert else "",
        "beep_count": beep_count,
        "damage_voice_text": "",
        "damage_alert_details": [],
        "damage_beep_count": 0,
    }


def build_error_result(message, camera_id="unknown", timestamp_ms=None):
    return {
        "success": False,
        "skill": SKILL_NAME,
        "cameraId": camera_id,
        "timestamp": timestamp_ms or int(time.time() * 1000),
        "error": str(message),
        "detections": [],
        "alerts": [],
        "meta": {"qwenReviewed": False},
        "text": f"YOLO safety skill error: {message}",
        "alert": False,
        "alert_details": [],
        "voice_reminder": False,
        "voice_text": "",
        "voice_texts": [],
        "risk_level": "none",
        "cleanup_hint": "",
        "evacuate_reminder": False,
        "evacuate_text": "",
        "beep_count": 0,
        "damage_voice_text": "",
        "damage_alert_details": [],
        "damage_beep_count": 0,
    }


def analyze_request(request):
    start = time.time()
    camera_id = safe_name(request.get("cameraId") or "active", "active")
    camera_label = safe_text(request.get("cameraLabel") or camera_id)
    video_path = safe_text(request.get("videoPath") or "")
    timestamp_ms = request.get("timestamp") or int(time.time() * 1000)
    config_overrides = {}
    if isinstance(request.get("detectionConfig"), dict):
        config_overrides.update(request.get("detectionConfig"))
    if isinstance(request.get("config"), dict):
        config_overrides.update(request.get("config"))
    config = build_config(config_overrides)
    image = decode_image_payload(request)

    try:
        model, model_path = get_model(config["modelProfile"])
    except Exception as exc:
        return build_error_result(exc, camera_id, timestamp_ms)

    try:
        min_conf = min(config["thresholds"].values())
        results = model.predict(image, verbose=False, conf=min_conf)
    except AttributeError:
        results = model(image, verbose=False)

    detections = extract_detections(results, model, config)
    alerts = GOVERNANCE.observe(camera_id, detections, time.time(), config)
    mark_qwen_review(alerts, config)

    meta = {
        "model": project_relative(model_path) if model_path != "yolov8n.pt" else "yolov8n.pt",
        "modelProfile": config["modelProfile"],
        "latencyMs": int((time.time() - start) * 1000),
        "qwenReviewed": False,
        "qwenReviewEnabled": bool(config.get("qwenReview")),
        "snapshotErrors": [],
        "sqliteErrors": [],
    }

    for alert in alerts:
        alert["cameraLabel"] = camera_label
        alert["videoPath"] = video_path
        alert["categoryCn"] = alert_category_cn(alert.get("type"))
        alert["modelName"] = meta["model"]
        alert["skillId"] = SKILL_NAME
        try:
            alert["snapshotPath"] = save_snapshot(image, camera_id, alert["type"], timestamp_ms)
        except Exception as exc:
            alert["snapshotError"] = str(exc)
            meta["snapshotErrors"].append(str(exc))
        try:
            alert["eventId"] = insert_alert_event(
                alert,
                timestamp_ms,
                raw_event={
                    "alert": alert,
                    "detections": detections,
                    "meta": meta,
                    "cameraId": camera_id,
                    "cameraLabel": camera_label,
                    "camera": {
                        "id": camera_id,
                        "label": camera_label,
                        "videoPath": video_path,
                    },
                    "timestamp": timestamp_ms,
                },
            )
        except Exception as exc:
            alert["sqliteError"] = str(exc)
            meta["sqliteErrors"].append(str(exc))

    return build_result(camera_id, timestamp_ms, detections, alerts, meta)


def handle_line(line):
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        return None
    if request.get("shutdown"):
        return "shutdown"
    try:
        return analyze_request(request)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        return build_error_result(exc, request.get("cameraId") or "unknown", request.get("timestamp"))


def main():
    print(json.dumps({"status": "ready"}), flush=True)
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        result = handle_line(line)
        if result == "shutdown":
            break
        if result is None:
            continue
        print(json.dumps({"result": result}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
