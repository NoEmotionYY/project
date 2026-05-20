# @name: audio-detector
# @label: 音频异常检测
# @description: 实时音频监控，检测异常高分贝声音并触发告警。支持设备选择、阈值调整、告警冷却等功能。
# @persistent: true
#
# Audio Detection Module:
# - Real-time audio monitoring using sounddevice library
# - Configurable detection thresholds for high-decibel sounds and explosions
# - Background thread processing to avoid blocking main application
# - Alert system with SQLite database storage (alerts.db)
# - Visual snapshot generation with warning information
# - Event broadcasting system via stdout JSON protocol
# - Configuration management with persistent settings
# - Audio device enumeration and selection
# - Alert cooldown mechanism to prevent spam
# - Comprehensive error handling and logging

import base64
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Windows 下设置标准输出为 UTF-8 编码，避免中文乱码
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import sounddevice as sd
    import numpy as np
except ImportError:
    sd = None
    np = None

SKILL_NAME = "audio-detector"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_ROOT = PROJECT_ROOT / "data" / "snapshots"
ALERT_DB_PATH = PROJECT_ROOT / "data" / "alerts.db"
CONFIG_FILE = PROJECT_ROOT / "data" / "audio-config.json"
RUNTIME_FRAME_DIR = PROJECT_ROOT / "data" / "runtime-frames"

# 确保数据目录存在
SNAPSHOT_ROOT.mkdir(parents=True, exist_ok=True)
ALERT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# 全局状态
_audio_detector = None
_is_running = False
_last_alert_time = 0
_alert_cooldown = 2.0  # 默认告警冷却时间（秒）
_detection_threshold = -15.0  # 默认检测阈值（dBFS）
_explosion_threshold = -5.0  # 爆炸声阈值（dBFS）
_current_device_id = None
_current_device_name = None

def load_config():
    """加载音频配置"""
    global _current_device_id, _current_device_name, _alert_cooldown, _detection_threshold, _explosion_threshold
    try:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                _current_device_id = config.get('device_id')
                _current_device_name = config.get('device_name', '系统默认麦克风')
                _alert_cooldown = float(config.get('alert_cooldown', 2.0))
                _detection_threshold = float(config.get('detection_threshold', -15.0))
                _explosion_threshold = float(config.get('explosion_threshold', -5.0))
        else:
            # 默认使用系统默认设备
            _current_device_id = None
            _current_device_name = "系统默认麦克风"
            _alert_cooldown = 2.0
            _detection_threshold = -15.0
            _explosion_threshold = -5.0
    except Exception as e:
        print(f"❌ 加载音频配置失败: {e}", file=sys.stderr)
        _current_device_id = None
        _current_device_name = "系统默认麦克风"
        _alert_cooldown = 2.0
        _detection_threshold = -15.0
        _explosion_threshold = -5.0

def save_config(device_id=None, device_name=None, alert_cooldown=None, detection_threshold=None, explosion_threshold=None):
    """保存音频配置"""
    global _current_device_id, _current_device_name, _alert_cooldown, _detection_threshold, _explosion_threshold
    try:
        if device_id is not None:
            _current_device_id = device_id
        if device_name is not None:
            _current_device_name = device_name
        if alert_cooldown is not None:
            _alert_cooldown = float(alert_cooldown)
        if detection_threshold is not None:
            _detection_threshold = float(detection_threshold)
        if explosion_threshold is not None:
            _explosion_threshold = float(explosion_threshold)
        
        config = {
            'device_id': _current_device_id,
            'device_name': _current_device_name or "系统默认麦克风",
            'alert_cooldown': _alert_cooldown,
            'detection_threshold': _detection_threshold,
            'explosion_threshold': _explosion_threshold,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print(f"❌ 保存音频配置失败: {e}", file=sys.stderr)

def get_audio_devices():
    """获取所有可用的音频输入设备"""
    if sd is None:
        return []
    
    try:
        devices = []
        all_devices = sd.query_devices()
        try:
            default_input = sd.default.device[0]  # 获取默认输入设备ID
        except (IndexError, TypeError):
            default_input = -1
            
        for i, device in enumerate(all_devices):
            if device['max_input_channels'] > 0:  # 只包含输入设备
                is_default = (i == default_input)
                devices.append({
                    'id': i,
                    'name': device['name'],
                    'channels': device['max_input_channels'],
                    'default_samplerate': device['default_samplerate'],
                    'is_default': is_default
                })
        
        return devices
    except Exception as e:
        print(f"❌ 获取音频设备列表失败: {e}", file=sys.stderr)
        return []

def init_database():
    """初始化告警数据库"""
    try:
        import sqlite3
        conn = sqlite3.connect(str(ALERT_DB_PATH))
        cursor = conn.cursor()
        cursor.execute('''
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
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ 初始化数据库失败: {e}", file=sys.stderr)

def get_current_frame():
    """获取当前摄像头的运行时帧，用于音频告警截图"""
    try:
        from PIL import Image as PILImage
        if not RUNTIME_FRAME_DIR.exists():
            return None
        # 查找最新的帧文件
        frame_files = list(RUNTIME_FRAME_DIR.glob("*.jpg"))
        if not frame_files:
            return None
        # 按修改时间排序，获取最新的帧
        frame_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        return PILImage.open(frame_files[0]).convert("RGB")
    except Exception as e:
        print(f"⚠️ 获取当前帧失败: {e}", file=sys.stderr)
        return None

def save_alert(db_level, timestamp, is_explosion=False):
    """保存音频告警到数据库，并截图当前画面"""
    try:
        import sqlite3
        from PIL import Image, ImageDraw
        
        # 区分颜色和文字
        bg_color = (139, 0, 0) if is_explosion else (255, 0, 0) # 爆炸用深红色，高分贝用红色
        category = "explosion" if is_explosion else "high-volume"
        severity = "critical" if is_explosion else "warning"
        alert_text = "爆炸声音告警" if is_explosion else "音频异常告警"
        desc_text = f"检测到爆炸声音: {db_level:.1f} dBFS" if is_explosion else f"检测到异常高分贝声音: {db_level:.1f} dBFS"
        
        # 优先使用当前摄像头画面
        snapshot_img = get_current_frame()
        if snapshot_img:
            # 直接在画面上叠加文字（不添加红色蒙版）
            draw = ImageDraw.Draw(snapshot_img)
            try:
                from PIL import ImageFont
                font_large = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 32) if hasattr(ImageFont, 'truetype') else None
                font_small = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 24) if hasattr(ImageFont, 'truetype') else None
            except Exception:
                font_large = None
                font_small = None
            
            title = f"⚠️ {alert_text}" if is_explosion else f"🔊 {alert_text}"
            text_top = f"{title}"
            text_bottom = f"{db_level:.1f} dBFS  |  {timestamp}"
            
            # 绘制顶部标题
            bbox = draw.textbbox((0, 0), text_top, font=font_large)
            text_width = bbox[2] - bbox[0]
            draw.text(((snapshot_img.size[0] - text_width) // 2, 20), text_top, fill=(255, 255, 255), font=font_large)
            
            # 绘制底部信息
            bbox = draw.textbbox((0, 0), text_bottom, font=font_small)
            text_width = bbox[2] - bbox[0]
            draw.text(((snapshot_img.size[0] - text_width) // 2, snapshot_img.size[1] - 40), text_bottom, fill=(255, 255, 255), font=font_small)
        else:
            # 如果没有摄像头画面，创建纯色背景带文字
            snapshot_img = Image.new('RGB', (640, 480), color=bg_color)
            draw = ImageDraw.Draw(snapshot_img)
            
            text = f"{alert_text}\n{db_level:.1f} dBFS"
            # 居中绘制文本
            bbox = draw.textbbox((0, 0), text, font=None)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            x = (640 - text_width) // 2
            y = (480 - text_height) // 2
            
            draw.text((x, y), text, fill=(255, 255, 255))
        
        # 保存快照
        snapshot_dir = SNAPSHOT_ROOT / timestamp[:10].replace('-', '/') / 'audio'
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        snapshot_filename = f"audio_alert_{timestamp.replace(':', '')}.jpg"
        snapshot_path = snapshot_dir / snapshot_filename
        snapshot_img.save(snapshot_path, quality=85)
        
        # 保存到数据库
        conn = sqlite3.connect(str(ALERT_DB_PATH))
        cursor = conn.cursor()
        
        import time
        from dateutil.parser import isoparse
        try:
            created_at_ms = int(isoparse(timestamp).timestamp() * 1000)
        except Exception:
            created_at_ms = int(time.time() * 1000)
            
        cursor.execute('''
            INSERT INTO alerts 
            (created_at, created_at_ms, camera_id, camera_label, category, category_cn, alert_type, title, severity, confidence, model_name, skill_id, message, snapshot_path, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            timestamp,
            created_at_ms,
            'audio',
            '音频检测',
            category,
            alert_text,
            'audio_alert',
            alert_text,
            severity,
            1.0,
            'audio-detector',
            'audio-detector',
            desc_text,
            str(snapshot_path.relative_to(PROJECT_ROOT)),
            json.dumps({'db_level': db_level, 'threshold': -15.0, 'device_id': _current_device_id, 'device_name': _current_device_name, 'is_explosion': is_explosion}, ensure_ascii=False)
        ))
        conn.commit()
        conn.close()
        
        return str(snapshot_path.relative_to(PROJECT_ROOT))
    except Exception as e:
        print(f"❌ 保存音频告警失败: {e}", file=sys.stderr)
        return None

def audio_callback(indata, frames, time_info, status):
    """音频流回调函数"""
    global _last_alert_time, _alert_cooldown, _detection_threshold, _explosion_threshold
    
    if status:
        print(f"⚠️ 音频流状态: {status}", file=sys.stderr)
        
    if np is None:
        return
        
    try:
        rms = np.sqrt(np.mean(np.square(indata)))
        rms = max(rms, 1e-10)
        db = float(20 * np.log10(rms))
        
        if db > _detection_threshold:  # 使用配置的阈值
            current_time = time.time()
            if current_time - _last_alert_time > _alert_cooldown:
                _last_alert_time = current_time
                timestamp = datetime.now(timezone.utc).isoformat()
                
                # 区分高分贝和爆炸声
                is_explosion = db > _explosion_threshold
                category = "explosion" if is_explosion else "high-volume"
                severity = "critical" if is_explosion else "warning"
                title_text = "爆炸声音告警" if is_explosion else "高分贝音频告警"
                desc_text = f"检测到爆炸声音! 实时音量: {db:.1f} dBFS" if is_explosion else f"检测到异常高分贝声音: {db:.1f} dBFS"
                
                print(f"🚨 [音频告警] {desc_text}", file=sys.stderr)
                
                # 先截图当前画面，再保存告警
                snapshot_path = save_alert(db, timestamp, is_explosion)
                
                # 发送告警事件到主进程（通过标准输出）
                alert_event = {
                    "type": "audio_alert",
                    "title": title_text,
                    "timestamp": timestamp,
                    "db_level": db,
                    "snapshotPath": snapshot_path,
                    "category": category,
                    "severity": severity,
                    "description": desc_text,
                    "device_id": _current_device_id,
                    "device_name": _current_device_name,
                    "cameraId": "audio",
                    "cameraLabel": _current_device_name or "麦克风"
                }
                event_output = json.dumps({"event": alert_event}, ensure_ascii=False)
                sys.stdout.buffer.write(event_output.encode('utf-8'))
                sys.stdout.buffer.write(b'\n')
                sys.stdout.buffer.flush()
    except Exception as e:
        print(f"❌ 音频回调处理失败: {e}", file=sys.stderr)

_audio_thread = None

def start_audio_stream():
    """启动音频流"""
    global _audio_detector, _is_running, _audio_thread
    
    if _is_running:
        return
        
    if sd is None or np is None:
        print("❌ 缺少必要的Python依赖: sounddevice 或 numpy", file=sys.stderr)
        return
        
    try:
        # 启动音频输入流（作为后台线程）
        def stream_thread():
            global _is_running
            _is_running = True
            try:
                # 使用 samplerate=None 自动适配设备默认采样率，避免硬件不支持时崩溃
                with sd.InputStream(
                    callback=audio_callback,
                    channels=1,
                    samplerate=None,
                    blocksize=2048,
                    device=_current_device_id  # 使用配置的设备ID
                ):
                    # 保持流运行直到被中断
                    while _is_running:
                        time.sleep(0.1)
            except Exception as e:
                print(f"❌ 音频流启动失败: {e}", file=sys.stderr)
            finally:
                _is_running = False
        
        _audio_thread = threading.Thread(target=stream_thread, daemon=True)
        _audio_thread.start()
        device_name = _current_device_name or "系统默认麦克风"
        print(f"🎙️ 音频监控已启动 (设备: {device_name})", file=sys.stderr)
        
    except Exception as e:
        print(f"❌ 启动音频监控失败: {e}", file=sys.stderr)

def stop_audio_stream():
    """停止音频流"""
    global _is_running
    _is_running = False
    print("⏹️ 音频监控已停止", file=sys.stderr)

def restart_audio_stream():
    """重启音频流（用于切换设备）"""
    global _audio_thread, _is_running
    
    _is_running = False
    if _audio_thread and _audio_thread.is_alive():
        _audio_thread.join(timeout=3.0)  # 优雅等待旧流关闭，防止设备占用冲突
        
    start_audio_stream()

def analyze_request(request):
    """处理分析请求"""
    camera_id = request.get("cameraId", "audio")
    timestamp = request.get("timestamp", int(time.time() * 1000))
    action = request.get("action")
    
    # 处理特殊动作
    if action == "get_devices":
        devices = get_audio_devices()
        return {
            "text": "获取音频设备列表成功",
            "devices": devices,
            "current_device_id": _current_device_id,
            "current_device_name": _current_device_name,
            "alert": False,
            "alert_details": [],
            "voice_reminder": False,
            "voice_text": "",
            "voice_texts": [],
            "risk_level": "none",
            "cleanup_hint": "",
            "evacuate_reminder": False,
            "evacuate_text": ""
        }
    elif action == "get_config":
        return {
            "text": "获取音频配置成功",
            "config": {
                "device_id": _current_device_id,
                "device_name": _current_device_name,
                "alert_cooldown": _alert_cooldown,
                "detection_threshold": _detection_threshold,
                "explosion_threshold": _explosion_threshold
            },
            "alert": False,
            "alert_details": [],
            "voice_reminder": False,
            "voice_text": "",
            "voice_texts": [],
            "risk_level": "none",
            "cleanup_hint": "",
            "evacuate_reminder": False,
            "evacuate_text": ""
        }
    elif action == "set_device":
        device_id = request.get("device_id")
        device_name = request.get("device_name")
        save_config(device_id, device_name)
        restart_audio_stream()
        return {
            "text": f"已切换到麦克风设备: {device_name}",
            "alert": False,
            "alert_details": [],
            "voice_reminder": False,
            "voice_text": "",
            "voice_texts": [],
            "risk_level": "none",
            "cleanup_hint": "",
            "evacuate_reminder": False,
            "evacuate_text": ""
        }
    elif action == "update_config":
        alert_cooldown = request.get("alert_cooldown")
        detection_threshold = request.get("detection_threshold")
        explosion_threshold = request.get("explosion_threshold")
        save_config(
            alert_cooldown=alert_cooldown,
            detection_threshold=detection_threshold,
            explosion_threshold=explosion_threshold
        )
        restart_audio_stream()
        return {
            "text": "音频检测配置已更新",
            "config": {
                "alert_cooldown": _alert_cooldown,
                "detection_threshold": _detection_threshold,
                "explosion_threshold": _explosion_threshold
            },
            "alert": False,
            "alert_details": [],
            "voice_reminder": False,
            "voice_text": "",
            "voice_texts": [],
            "risk_level": "none",
            "cleanup_hint": "",
            "evacuate_reminder": False,
            "evacuate_text": ""
        }
    
    # 首次调用时启动音频流
    if not _is_running:
        load_config()
        init_database()
        start_audio_stream()
    
    # 返回当前状态（音频检测是持续性的，不需要对每帧图像进行分析）
    result = {
        "text": "音频异常检测正在运行",
        "alert": False,
        "alert_details": [],
        "voice_reminder": False,
        "voice_text": "",
        "voice_texts": [],
        "risk_level": "none",
        "cleanup_hint": "",
        "evacuate_reminder": False,
        "evacuate_text": ""
    }
    
    return result

def handle_line(line):
    """处理来自主进程的单行请求"""
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        return None
        
    if request.get("shutdown"):
        stop_audio_stream()
        return "shutdown"
        
    try:
        return analyze_request(request)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        return {
            "text": f"音频检测错误: {str(exc)}",
            "alert": False,
            "alert_details": [],
            "voice_reminder": False,
            "voice_text": "",
            "voice_texts": [],
            "risk_level": "none",
            "cleanup_hint": "",
            "evacuate_reminder": False,
            "evacuate_text": ""
        }

def main():
    """主函数 - 持久化进程入口"""
    # 初始化配置
    load_config()
    
    # 强制 Windows 控制台使用 UTF-8 编码
    if sys.platform == 'win32':
        os.environ['PYTHONIOENCODING'] = 'utf-8'
    
    print(json.dumps({"status": "ready"}), flush=True)
    
    # 初始化数据库
    init_database()
    
    while True:
        try:
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
                
            # 输出结果到主进程，统一使用UTF-8字节输出
            output = json.dumps({"result": result}, ensure_ascii=False)
            sys.stdout.buffer.write(output.encode('utf-8'))
            sys.stdout.buffer.write(b'\n')
            sys.stdout.buffer.flush()
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ 主循环错误: {e}", file=sys.stderr)
            break
    
    stop_audio_stream()

if __name__ == "__main__":
    main()