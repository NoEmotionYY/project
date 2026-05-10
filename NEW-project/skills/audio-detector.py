# @name: audio-detector
# @label: 音频异常检测
# @description: 实时音频监控，检测异常高分贝声音并触发告警
# @persistent: true

import base64
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

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

# 确保数据目录存在
SNAPSHOT_ROOT.mkdir(parents=True, exist_ok=True)
ALERT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# 全局状态
_audio_detector = None
_is_running = False
_last_alert_time = 0
_alert_cooldown = 2.0
_current_device_id = None
_current_device_name = None

def load_config():
    """加载音频配置"""
    global _current_device_id, _current_device_name
    try:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                _current_device_id = config.get('device_id')
                _current_device_name = config.get('device_name')
        else:
            # 默认使用系统默认设备
            _current_device_id = None
            _current_device_name = "系统默认麦克风"
    except Exception as e:
        print(f"❌ 加载音频配置失败: {e}", file=sys.stderr)
        _current_device_id = None
        _current_device_name = "系统默认麦克风"

def save_config(device_id=None, device_name=None):
    """保存音频配置"""
    global _current_device_id, _current_device_name
    try:
        _current_device_id = device_id
        _current_device_name = device_name or "系统默认麦克风"
        
        config = {
            'device_id': device_id,
            'device_name': device_name or "系统默认麦克风",
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
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                camera_id TEXT DEFAULT 'audio',
                camera_label TEXT DEFAULT '音频检测',
                category TEXT NOT NULL,
                severity TEXT NOT NULL,
                description TEXT,
                snapshot_path TEXT,
                raw_json TEXT,
                needs_review BOOLEAN DEFAULT 0
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ 初始化数据库失败: {e}", file=sys.stderr)

def save_alert(db_level, timestamp):
    """保存音频告警到数据库"""
    try:
        import sqlite3
        from PIL import Image, ImageDraw
        
        # 创建告警快照（纯色背景带文字）
        snapshot_img = Image.new('RGB', (640, 480), color=(255, 0, 0))  # 红色背景
        draw = ImageDraw.Draw(snapshot_img)
        
        text = f"音频异常告警\n{db_level:.1f} dBFS"
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
        cursor.execute('''
            INSERT INTO alerts 
            (timestamp, camera_id, camera_label, category, severity, description, snapshot_path, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            timestamp,
            'audio',
            '音频检测',
            'high-volume',
            'warning',
            f'检测到异常高分贝声音: {db_level:.1f} dBFS',
            str(snapshot_path.relative_to(PROJECT_ROOT)),
            json.dumps({'db_level': db_level, 'threshold': -15.0, 'device_id': _current_device_id, 'device_name': _current_device_name})
        ))
        conn.commit()
        conn.close()
        
        return str(snapshot_path.relative_to(PROJECT_ROOT))
    except Exception as e:
        print(f"❌ 保存音频告警失败: {e}", file=sys.stderr)
        return None

def audio_callback(indata, frames, time_info, status):
    """音频流回调函数"""
    global _last_alert_time, _alert_cooldown
    
    if status:
        print(f"⚠️ 音频流状态: {status}", file=sys.stderr)
        
    if np is None:
        return
        
    try:
        rms = np.sqrt(np.mean(np.square(indata)))
        rms = max(rms, 1e-10)
        db = float(20 * np.log10(rms))
        
        if db > -15.0:  # 固定阈值 -15.0 dBFS
            current_time = time.time()
            if current_time - _last_alert_time > _alert_cooldown:
                _last_alert_time = current_time
                timestamp = datetime.now(timezone.utc).isoformat()
                snapshot_path = save_alert(db, timestamp)
                print(f"🚨 [音频告警] 检测到异常高分贝声音! 实时音量: {db:.1f} dBFS", file=sys.stderr)
                
                # 发送告警事件到主进程（通过标准输出）
                alert_event = {
                    "type": "audio_alert",
                    "title": "高分贝音频告警",
                    "timestamp": timestamp,
                    "db_level": db,
                    "snapshotPath": snapshot_path,
                    "category": "high-volume",
                    "severity": "warning",
                    "description": f"检测到异常高分贝声音: {db:.1f} dBFS",
                    "device_id": _current_device_id,
                    "device_name": _current_device_name,
                    "cameraId": "audio",
                    "cameraLabel": _current_device_name or "麦克风"
                }
                print(json.dumps({"event": alert_event}, ensure_ascii=False), flush=True)
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
                
            # 输出结果到主进程
            print(json.dumps({"result": result}, ensure_ascii=False), flush=True)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ 主循环错误: {e}", file=sys.stderr)
            break
    
    stop_audio_stream()

if __name__ == "__main__":
    main()