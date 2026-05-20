# @name: wechat-push
# @label: 企业微信推送
# @description: 自动将系统运行状态与异常告警推送到企业微信群，实现移动端实时联动。
# @persistent: true

import json
import sys
import urllib.request
import traceback
import os

# 强制标准输出、错误输出和标准输入使用 UTF-8 编码，解决中文乱码问题
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='backslashreplace')
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8', errors='backslashreplace')

# 你的企业微信 Webhook 链接（优先从环境变量读取）
WEBHOOK_URL = os.getenv('WECHAT_WEBHOOK_URL', "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1ffc58c7-aeab-4a1b-b52f-5136429978bd")

def send_wechat_msg(content):
    """
    发送消息到企业微信，确保使用 UTF-8 编码
    """
    data = {
        "msgtype": "markdown",
        "markdown": {
            "content": content
        }
    }
    try:
        # 确保 JSON 数据使用 UTF-8 编码
        json_data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=json_data,
            headers={'Content-Type': 'application/json; charset=utf-8'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            result = response.read().decode('utf-8')
            return response.status == 200
    except Exception as e:
        print(f"❌ 企业微信推送失败: {e}", file=sys.stderr)
        return False

def handle_line(line):
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        return None

    if req.get("shutdown"):
        return "shutdown"

    # 支持技能管理器的 analyze 接口（带 action 字段）
    action = req.get("action")
    
    if action == "startup":
        import datetime
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        msg = (
            "🟢 **CYPHER 系统开机通知**\n"
            "> 系统已成功启动，各项核心监控组件运行正常。\n"
            f"> 开机时间：<font color='comment'>{current_time}</font>\n"
            "> 已进入实时安全守护状态，随时待命！"
        )
        send_wechat_msg(msg)
        return {"text": "开机推送成功"}

    elif action == "send_alert":
        title = req.get("title", "系统安全告警")
        desc = req.get("description", "检测到未知异常")
        camera = req.get("camera", "未知监控点")
        time = req.get("time", "")

        msg = (
            f"🔴 **{title}**\n"
            f"> 监控位置：<font color='info'>{camera}</font>\n"
            f"> 告警时间：<font color='comment'>{time}</font>\n"
            f"> 风险详情：<font color='warning'>{desc}</font>\n"
            "\n"
            "**请相关安全人员立即核实现场情况！**"
        )
        send_wechat_msg(msg)
        return {"text": "告警推送成功"}

    # 兼容旧版：如果没有 action 字段，但有 alerts 或 alert 字段，当作告警处理
    alerts = req.get("alerts", [])
    if not action and (req.get("alert") or (isinstance(alerts, list) and len(alerts) > 0)):
        # 从分析结果中提取告警信息
        if isinstance(alerts, list) and len(alerts) > 0:
            for alert in alerts:
                title = alert.get("title", "系统安全告警")
                desc = alert.get("description", alert.get("message", "检测到异常"))
                camera = alert.get("cameraId", alert.get("camera", "未知监控点"))
                time = alert.get("timestamp", req.get("time", ""))
                
                msg = (
                    f"🔴 **{title}**\n"
                    f"> 监控位置：<font color='info'>{camera}</font>\n"
                    f"> 告警时间：<font color='comment'>{time}</font>\n"
                    f"> 风险详情：<font color='warning'>{desc}</font>\n"
                    "\n"
                    "**请相关安全人员立即核实现场情况！**"
                )
                send_wechat_msg(msg)
        return {"text": "告警推送成功"}

    return {"text": "企业微信推送模块运行中"}

def main():
    print(json.dumps({"status": "ready"}), flush=True)
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
            if result:
                print(json.dumps({"result": result}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(f"❌ 推送主循环错误: {e}", file=sys.stderr)
            break

if __name__ == "__main__":
    main()