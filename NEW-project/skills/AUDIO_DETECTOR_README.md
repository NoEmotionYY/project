# Audio Detection Module

## Overview

The Audio Detection Module provides real-time audio monitoring capabilities for detecting abnormal high-decibel sounds and potential explosion noises. It uses the `sounddevice` library for audio capture and implements configurable thresholds, alert cooldowns, and persistent storage.

## Features

### Audio Detection Class (AudioDetector)
- **Real-time audio monitoring** using sounddevice library
- **Configurable detection thresholds**:
  - High-decibel detection threshold (default: -15.0 dBFS)
  - Explosion detection threshold (default: -5.0 dBFS)
- **Background thread processing** to avoid blocking main application
- **Automatic device selection** with support for multiple audio input devices

### Alert System
- **Database storage** of alerts in SQLite (`alerts.db`)
  - Stores timestamp, severity, category, confidence, and snapshot paths
  - Supports querying and filtering by camera/device, category, and time range
- **Visual snapshot generation** with warning information
  - Creates color-coded images (red for high-volume, dark red for explosions)
  - Includes decibel level and alert type text overlay
- **Event broadcasting system** via stdout JSON protocol
  - Sends structured alert events to the main Node.js process
  - Enables real-time UI notifications and logging
- **Alert categorization**:
  - `high-volume`: Abnormal loud sounds
  - `explosion`: Potential explosion or extremely loud sounds

### Configuration Management
- **Device selection and configuration**:
  - Enumerate all available audio input devices
  - Select specific microphone or use system default
  - Persistent device preference storage
- **Threshold adjustment capabilities**:
  - Adjustable detection threshold for high-volume sounds
  - Separate threshold for explosion detection
  - Real-time configuration updates without restart
- **Persistent settings storage** in `data/audio-config.json`:
  ```json
  {
    "device_id": null,
    "device_name": "系统默认麦克风",
    "alert_cooldown": 2.0,
    "detection_threshold": -15.0,
    "explosion_threshold": -5.0,
    "timestamp": "2026-05-12T..."
  }
  ```

### Utility Functions
- **Audio device enumeration** (`get_audio_devices()`):
  - Lists all available input devices with metadata
  - Identifies default system microphone
  - Returns device ID, name, channels, and sample rate
- **Alert cooldown mechanism**:
  - Configurable cooldown period (default: 2 seconds)
  - Prevents alert spam during continuous loud sounds
  - Automatically resets after cooldown expires
- **Error handling and logging**:
  - Comprehensive error messages to stderr
  - Graceful degradation when dependencies are missing
  - Automatic restart on stream failures (max 1 retry)

## API Endpoints

### Get Available Audio Devices
```
GET /api/skills/audio-detector/devices
```
Returns list of all available audio input devices.

### Get Current Configuration
```
GET /api/skills/audio-detector/config
```
Returns current audio detection configuration including thresholds and selected device.

### Set Audio Device
```
POST /api/skills/audio-detector/device
Content-Type: application/json

{
  "device_id": 1,
  "device_name": "Built-in Microphone"
}
```
Switches to a different audio input device.

### Update Detection Configuration
```
POST /api/skills/audio-detector/config
Content-Type: application/json

{
  "alert_cooldown": 3.0,
  "detection_threshold": -18.0,
  "explosion_threshold": -8.0
}
```
Updates detection thresholds and alert cooldown settings.

## Database Schema

Alerts are stored in `data/alerts.db` with the following schema:

```sql
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER,
  camera_id TEXT NOT NULL,           -- 'audio' for audio alerts
  camera_label TEXT,                  -- Device name
  category TEXT NOT NULL,             -- 'high-volume' or 'explosion'
  category_cn TEXT NOT NULL,          -- Chinese category name
  alert_type TEXT NOT NULL,           -- 'audio_alert'
  title TEXT NOT NULL,                -- Alert title
  severity TEXT NOT NULL,             -- 'warning' or 'critical'
  confidence REAL,                    -- Always 1.0 for audio
  model_name TEXT,                    -- 'audio-detector'
  skill_id TEXT,                      -- 'audio-detector'
  message TEXT,                       -- Human-readable description
  snapshot_path TEXT,                 -- Path to snapshot image
  video_path TEXT,                    -- Optional video path
  source_skill TEXT,                  -- 'audio-detector'
  reviewed_by_qwen INTEGER DEFAULT 0,
  qwen_result TEXT,
  raw_json TEXT                       -- Full event data as JSON
);
```

## Usage Example

### Enable Audio Detection Skill
```javascript
// Via skill manager
await skillManager.toggleSkill('audio-detector', true);
```

### Query Alerts from Database
```python
import sqlite3
from pathlib import Path

db_path = Path('data/alerts.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get recent audio alerts
cursor.execute('''
  SELECT created_at, title, severity, message, snapshot_path
  FROM alerts
  WHERE camera_id = 'audio'
  ORDER BY created_at DESC
  LIMIT 10
''')

alerts = cursor.fetchall()
for alert in alerts:
    print(f"{alert[0]} - {alert[1]} ({alert[2]}): {alert[3]}")
    print(f"  Snapshot: {alert[4]}")

conn.close()
```

### Monitor Audio Events in Real-time
The audio detector broadcasts events via stdout in JSON format:
```json
{
  "event": {
    "type": "audio_alert",
    "title": "高分贝音频告警",
    "timestamp": "2026-05-12T09:25:40.123456+00:00",
    "db_level": -12.5,
    "snapshotPath": "data/snapshots/2026/05/12/audio/audio_alert_2026-05-12T092540.jpg",
    "category": "high-volume",
    "severity": "warning",
    "description": "检测到异常高分贝声音: -12.5 dBFS",
    "device_id": null,
    "device_name": "系统默认麦克风",
    "cameraId": "audio",
    "cameraLabel": "系统默认麦克风"
  }
}
```

## Dependencies

- **Python packages**:
  - `sounddevice`: Audio stream capture
  - `numpy`: Audio signal processing (RMS calculation)
  - `Pillow`: Snapshot image generation
  - `python-dateutil`: Timestamp parsing
  
Install with:
```bash
pip install sounddevice numpy Pillow python-dateutil
```

## Configuration File

Location: `data/audio-config.json`

```json
{
  "device_id": null,              // null = system default, or integer device ID
  "device_name": "系统默认麦克风",  // Human-readable device name
  "alert_cooldown": 2.0,          // Seconds between alerts
  "detection_threshold": -15.0,   // dBFS threshold for high-volume detection
  "explosion_threshold": -5.0,    // dBFS threshold for explosion detection
  "timestamp": "2026-05-12T..."   // Last configuration update time
}
```

## Troubleshooting

### No Audio Detected
1. Check if microphone permissions are granted
2. Verify device selection in configuration
3. Test with `get_devices` endpoint to see available devices
4. Adjust `detection_threshold` to be more sensitive (e.g., -20.0)

### Too Many Alerts
1. Increase `alert_cooldown` value (e.g., 5.0 seconds)
2. Lower `detection_threshold` (e.g., -10.0) to require louder sounds
3. Check background noise levels in environment

### Module Not Loading
1. Verify Python dependencies are installed
2. Check stderr logs for import errors
3. Ensure `PYTHON_PATH` environment variable is set correctly
4. Review skill-manager logs for startup failures

## Architecture

The audio detector runs as a persistent Python subprocess managed by the Node.js skill manager:

```
Node.js Server (server.js)
  └─> Skill Manager (skill-manager.js)
       └─> Persistent Python Process (audio-detector.py)
            ├─> Audio Stream Thread (sounddevice)
            ├─> Alert Database (SQLite)
            └─> Configuration Manager (JSON)
```

Communication happens via stdin/stdout JSON protocol:
- **Input**: JSON commands via stdin
- **Output**: JSON results and events via stdout
- **Errors**: Logged to stderr

## Security Considerations

- Audio data is processed in-memory and not stored
- Only metadata (decibel levels, timestamps) persist in database
- Snapshots are generated programmatically (no actual audio recording)
- Device access requires user permission on macOS/Windows
- All file paths are sanitized to prevent directory traversal
