import asyncio
import json
import os
import cv2
import numpy as np
import threading
import ssl
import socket
import time
import base64
from datetime import datetime
from aiohttp import web, ClientSession, ClientTimeout
from aiortc import RTCPeerConnection, RTCSessionDescription

# ==========================================
# 阿里云 Qwen-VL 配置
# ==========================================
DASHSCOPE_API_KEY = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY", "")
QWEN_MODEL = "qwen-vl-plus"
ANALYSIS_INTERVAL = 3  # 分析间隔（秒）

# 精简提示词 - 更短，模型输出更快
ANALYSIS_PROMPT = """分析图片中的安全情况，用简洁中文回答：
1. 逐人描述：穿着、安全帽佩戴状态
2. 仅列出真正违规项（未戴安全帽、穿拖鞋/短裤等）
3. 其他环境隐患
注意：已正确佩戴安全帽的人员不要列为违规。"""

DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

# ==========================================
# 全局变量
# ==========================================
latest_frame_bgr = None
frame_lock = threading.Lock()
frampool = set()

# AI 分析结果
ai_analysis_result = "等待分析..."
ai_analysis_time = ""
ai_analysis_lock = threading.Lock()
ai_is_analyzing = False

# 警报状态
alert_active = False
alert_message = ""
alert_details = []
alert_lock = threading.Lock()

# SSE 推送队列
sse_queues = []
sse_lock = threading.Lock()

# ==========================================
# 日志文件
# ==========================================
LOG_FILE = os.path.join(os.path.dirname(__file__), "ai_analysis_log.txt")

def write_log(timestamp, result, is_alert=False, alert_details=None):
    """写入分析日志"""
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        alert_mark = " [ALERT]" if is_alert else ""
        f.write(f"[{timestamp}]{alert_mark}\n")
        if alert_details:
            f.write(f"警报详情: {', '.join(alert_details)}\n")
        f.write(f"{result}\n")
        f.write("-" * 60 + "\n")

# ==========================================
# 安全风险检测（上下文感知版）
# ==========================================

NEGATIVE_PREFIXES = ["无", "没有", "不存在", "未发现", "未出现"]

HELMET_ALERT_PATTERNS = [
    ("未佩戴安全帽", "人员未佩戴安全帽"),
    ("未戴安全帽", "人员未佩戴安全帽"),
    ("没佩戴安全帽", "人员未佩戴安全帽"),
    ("没戴安全帽", "人员未佩戴安全帽"),
]

CLOTHING_ALERT_PATTERNS = [
    ("穿拖鞋", "人员穿拖鞋作业"),
    ("穿短裤", "人员穿短裤作业"),
    ("穿背心", "人员穿背心作业"),
    ("穿凉鞋", "人员穿凉鞋作业"),
]

ENV_ALERT_PATTERNS = [
    ("违规操作", "存在违规操作"),
    ("发生火灾", "发生火灾"),
    ("杂物堆积", "存在杂物堆积"),
]

def is_real_risk(text, risk_idx, window_size=10):
    """检查风险词前面是否有否定词"""
    prefix_start = max(0, risk_idx - window_size)
    prefix = text[prefix_start:risk_idx]
    for neg in NEGATIVE_PREFIXES:
        if prefix.endswith(neg) or neg in prefix:
            return False
    return True

def check_safety_risk(text):
    """检测安全风险 - 带上下文感知"""
    text_lower = text.lower()
    detected = []

    # 1. 安全帽检测
    helmet_alert = False
    for pattern, desc in HELMET_ALERT_PATTERNS:
        idx = text_lower.find(pattern)
        if idx >= 0:
            if is_real_risk(text_lower, idx):
                helmet_alert = True
                break

    if helmet_alert:
        detected.append("人员未佩戴安全帽")

    # 2. 穿着检测
    for pattern, desc in CLOTHING_ALERT_PATTERNS:
        idx = text_lower.find(pattern)
        if idx >= 0:
            if is_real_risk(text_lower, idx):
                detected.append(desc)

    # 3. 环境风险
    for pattern, desc in ENV_ALERT_PATTERNS:
        if pattern in text_lower:
            detected.append(desc)

    detected = list(dict.fromkeys(detected))
    return len(detected) > 0, detected

# ==========================================
# SSE 推送
# ==========================================
async def broadcast_analysis(data):
    """向所有 SSE 客户端推送分析结果"""
    dead_queues = []
    payload = json.dumps(data)
    with sse_lock:
        clients = list(sse_queues)
    for q in clients:
        try:
            await q.put(payload)
        except Exception:
            dead_queues.append(q)
    if dead_queues:
        with sse_lock:
            for q in dead_queues:
                if q in sse_queues:
                    sse_queues.remove(q)

# ==========================================
# Qwen-VL 异步分析
# ==========================================
async def analyze_frame_with_qwen_async(frame_bgr, session: ClientSession):
    """异步执行 AI 分析"""
    global ai_analysis_result, ai_analysis_time, ai_is_analyzing
    global alert_active, alert_message, alert_details

    try:
        with ai_analysis_lock:
            ai_is_analyzing = True

        if not DASHSCOPE_API_KEY:
            raise RuntimeError("Qwen API key is missing. Please set QWEN_API_KEY or DASHSCOPE_API_KEY.")

        print(f"[AI] 开始分析帧... {datetime.now().strftime('%H:%M:%S')}")

        # 压缩图片 - 更小更快
        max_size = 640
        h, w = frame_bgr.shape[:2]
        if max(h, w) > max_size:
            scale = max_size / max(h, w)
            frame_bgr = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)))

        _, img_encoded = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 75])
        img_base64 = base64.b64encode(img_encoded).decode('utf-8')
        img_url = f"data:image/jpeg;base64,{img_base64}"

        payload = {
            "model": QWEN_MODEL,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"image": img_url},
                            {"text": ANALYSIS_PROMPT}
                        ]
                    }
                ]
            }
        }

        headers = {
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json"
        }

        timeout = ClientTimeout(total=30, connect=10)
        async with session.post(DASHSCOPE_URL, json=payload, headers=headers, timeout=timeout) as resp:
            response_data = await resp.json()

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if resp.status == 200 and response_data.get("output"):
            choices = response_data["output"].get("choices", [])
            if choices and len(choices) > 0:
                content = choices[0].get("message", {}).get("content", [])
                if content and len(content) > 0:
                    result_text = content[0].get("text", "分析返回为空")
                else:
                    result_text = "分析返回为空"
            else:
                result_text = "分析返回为空"

            # 检测安全风险
            has_risk, risk_categories = check_safety_risk(result_text)

            with ai_analysis_lock:
                ai_analysis_result = result_text
                ai_analysis_time = datetime.now().strftime("%H:%M:%S")

            with alert_lock:
                if has_risk:
                    alert_active = True
                    alert_details = risk_categories
                    alert_message = f"检测到安全风险: {'; '.join(risk_categories)}"
                    print(f"[ALERT] {alert_message}")
                else:
                    alert_active = False
                    alert_message = ""
                    alert_details = []

            write_log(timestamp, result_text, is_alert=has_risk, alert_details=risk_categories if has_risk else None)
            print(f"[AI分析成功] {ai_analysis_time}")

            # SSE 实时推送
            with ai_analysis_lock:
                result_text_push = ai_analysis_result
                result_time_push = ai_analysis_time
                analyzing_push = ai_is_analyzing
            with alert_lock:
                alert_push = alert_active
                alert_msg_push = alert_message
                alert_dtl_push = alert_details.copy() if alert_details else []

            await broadcast_analysis({
                "text": result_text_push,
                "time": result_time_push,
                "analyzing": analyzing_push,
                "alert": alert_push,
                "alert_message": alert_msg_push,
                "alert_details": alert_dtl_push
            })
        else:
            error_msg = f"分析失败: HTTP {resp.status}"
            with ai_analysis_lock:
                ai_analysis_result = error_msg
            write_log(timestamp, error_msg)

    except Exception as e:
        error_msg = f"分析异常: {str(e)}"
        with ai_analysis_lock:
            ai_analysis_result = error_msg
        write_log(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), error_msg)
        print(f"[AI分析异常] {error_msg}")
    finally:
        with ai_analysis_lock:
            ai_is_analyzing = False
        print(f"[AI] 分析完成 {datetime.now().strftime('%H:%M:%S')}")

# ==========================================
# HTTP 路由
# ==========================================
async def index_client(request):
    """前端摄像头推流页面"""
    content = open(os.path.join(os.path.dirname(__file__), "webrtc-client.html"), "r", encoding="utf-8").read()
    return web.Response(content_type="text/html", text=content)

async def index_monitor(request):
    """后端监控页面"""
    content = open(os.path.join(os.path.dirname(__file__), "monitor.html"), "r", encoding="utf-8").read()
    return web.Response(content_type="text/html", text=content)

async def process_video_track(track):
    """独立异步函数处理视频轨道"""
    last_analysis_time = 0
    frame_count = 0

    timeout = ClientTimeout(total=30, connect=10)
    async with ClientSession(timeout=timeout) as session:
        while True:
            try:
                frame = await track.recv()
                frame_count += 1

                # 抽帧防积压
                dropped = 0
                while True:
                    try:
                        frame = await asyncio.wait_for(track.recv(), timeout=0.001)
                        dropped += 1
                    except asyncio.TimeoutError:
                        break

                if dropped > 0:
                    print(f"[抽帧] 丢弃了 {dropped} 帧")

                img_bgr = frame.to_ndarray(format="bgr24")

                with frame_lock:
                    global latest_frame_bgr
                    latest_frame_bgr = img_bgr

                # 定时触发 AI 分析
                current_time = time.time()
                should_analyze = False

                with ai_analysis_lock:
                    if (current_time - last_analysis_time >= ANALYSIS_INTERVAL) and not ai_is_analyzing:
                        should_analyze = True

                if should_analyze:
                    last_analysis_time = current_time
                    frame_copy = img_bgr.copy()

                    # 提交新分析前，先清除旧警报
                    with alert_lock:
                        alert_active = False
                        alert_message = ""
                        alert_details = []

                    with ai_analysis_lock:
                        ai_analysis_result = "正在分析当前画面..."
                        ai_analysis_time = datetime.now().strftime("%H:%M:%S")

                    # 异步启动分析任务（不阻塞视频流）
                    asyncio.create_task(analyze_frame_with_qwen_async(frame_copy, session))
                    print(f"[定时] 已提交 AI 分析任务，帧 #{frame_count}")

            except Exception as e:
                print(f"视频流断开: {e}")
                break

async def offer(request):
    """WebRTC 信令交换"""
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    frampool.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print(f"WebRTC 状态: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            await pc.close()
            frampool.discard(pc)

    @pc.on("track")
    def on_track(track):
        if track.kind == "video":
            print("视频流已接入")
            asyncio.ensure_future(process_video_track(track))

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}),
    )

async def api_frame(request):
    """获取最新视频帧 (JPEG)"""
    with frame_lock:
        frame = latest_frame_bgr

    if frame is None:
        return web.Response(status=404, text="No frame available")

    _, img_encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return web.Response(body=img_encoded.tobytes(), content_type="image/jpeg")

async def api_analysis(request):
    """获取 AI 分析结果和警报状态"""
    with ai_analysis_lock:
        result_text = ai_analysis_result
        result_time = ai_analysis_time
        analyzing = ai_is_analyzing

    with alert_lock:
        alert = alert_active
        alert_msg = alert_message
        alert_dtl = alert_details.copy() if alert_details else []

    result = {
        "text": result_text,
        "time": result_time,
        "analyzing": analyzing,
        "alert": alert,
        "alert_message": alert_msg,
        "alert_details": alert_dtl
    }
    return web.Response(content_type="application/json", text=json.dumps(result))

async def api_events(request):
    """SSE 实时推送分析结果"""
    response = web.StreamResponse()
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Connection'] = 'keep-alive'
    response.headers['Access-Control-Allow-Origin'] = '*'
    await response.prepare(request)

    q = asyncio.Queue()
    with sse_lock:
        sse_queues.append(q)

    # 先推送一次当前状态
    with ai_analysis_lock:
        result_text = ai_analysis_result
        result_time = ai_analysis_time
        analyzing = ai_is_analyzing
    with alert_lock:
        alert = alert_active
        alert_msg = alert_message
        alert_dtl = alert_details.copy() if alert_details else []

    init_data = json.dumps({
        "text": result_text,
        "time": result_time,
        "analyzing": analyzing,
        "alert": alert,
        "alert_message": alert_msg,
        "alert_details": alert_dtl
    })
    await response.write(f"data: {init_data}\n\n".encode('utf-8'))

    try:
        while True:
            data = await asyncio.wait_for(q.get(), timeout=30)
            await response.write(f"data: {data}\n\n".encode('utf-8'))
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass
    finally:
        with sse_lock:
            if q in sse_queues:
                sse_queues.remove(q)

    return response

async def on_shutdown(app):
    coros = [pc.close() for pc in frampool]
    await asyncio.gather(*coros)
    frampool.clear()

# ==========================================
# 获取本机所有 IP 地址
# ==========================================
def get_lan_ips():
    """获取局域网 IP 地址（排除 127.0.0.1）"""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        if not ip.startswith('127.'):
            ips.append(ip)
        s.close()
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        for ip in ip_list:
            if ip not in ips and not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass

    try:
        import psutil
        for interface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    ip = addr.address
                    if ip not in ips and not ip.startswith('127.'):
                        ips.append(ip)
    except ImportError:
        pass

    if not ips:
        ips.append("无法获取局域网IP")

    return ips

SERVER_IPS = get_lan_ips()

async def api_info(request):
    """获取服务器信息（IP地址等）"""
    result = {
        "ips": SERVER_IPS,
        "port": 8082,
        "urls": {
            "client": [f"https://{ip}:8082" for ip in SERVER_IPS],
            "monitor": [f"https://{ip}:8082/monitor" for ip in SERVER_IPS]
        }
    }
    return web.Response(content_type="application/json", text=json.dumps(result))

def run_server():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    app = web.Application()
    app.on_shutdown.append(on_shutdown)

    app.router.add_get("/", index_client)
    app.router.add_get("/monitor", index_monitor)
    app.router.add_post("/offer", offer)
    app.router.add_get("/api/frame", api_frame)
    app.router.add_get("/api/analysis", api_analysis)
    app.router.add_get("/api/events", api_events)  # SSE 实时推送
    app.router.add_get("/api/info", api_info)

    runner = web.AppRunner(app)
    loop.run_until_complete(runner.setup())

    script_dir = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(script_dir, 'cert.pem')
    key_path = os.path.join(script_dir, 'key.pem')

    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(cert_path, key_path)

    site = web.TCPSite(runner, '0.0.0.0', 8082, ssl_context=ssl_context)
    loop.run_until_complete(site.start())

    main_ip = SERVER_IPS[0] if SERVER_IPS else "localhost"

    print("=" * 60)
    print("服务器已启动！")
    print("")
    print(f"【访问地址】")
    print(f"  https://{main_ip}:8082          (前端推流)")
    print(f"  https://{main_ip}:8082/monitor  (监控页面)")

    if len(SERVER_IPS) > 1:
        print("")
        print("【其他可用 IP】")
        for ip in SERVER_IPS[1:]:
            print(f"  https://{ip}:8082")

    print("=" * 60)

    try:
        loop.run_forever()
    except Exception:
        pass

if __name__ == "__main__":
    run_server()
