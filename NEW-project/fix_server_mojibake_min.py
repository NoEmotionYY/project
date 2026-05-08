from pathlib import Path

targets = [
    Path("server.js"),
    Path("src/server.js"),
]

replacements = {
    "// 鏃х増鍏煎": "// 旧版兼容",
    "// 濡傛灉宸插湪录制锛屽厛鍋滄鏃х殑": "// 如果已经在录制，先停止旧的",
    "// 甯х巼鎺у埗": "// 帧率控制",
    "'姝ｅ湪鍒嗘瀽褰撳墠鐢婚潰...'": "'正在分析当前画面...'",
    "`鍒嗘瀽寮傚父: ${e.message}`": "`分析异常: ${e.message}`",
    "'[AI鍒嗘瀽寮傚父]'": "'[AI分析异常]'",
    "// 鑾峰彇 AI 鍒嗘瀽缁撴灉": "// 获取 AI 分析结果",
    "完成锛岃€楁椂": "完成，耗时",
    "'鍒嗘瀽寮傚父: ' + e.message": "'分析异常: ' + e.message",
    "'鎵嬫満鎺ㄦ祦'": "'手机推流'",
}

for file in targets:
    if not file.exists():
        print(f"[skip] {file} not found")
        continue

    text = file.read_text(encoding="utf-8")
    original = text
    changed = 0

    for old, new in replacements.items():
        count = text.count(old)
        if count:
            text = text.replace(old, new)
            changed += count
            print(f"[fix] {file}: {old} -> {new} x{count}")

    if text != original:
        file.write_text(text, encoding="utf-8", newline="")
        print(f"[write] {file}, replacements={changed}")
    else:
        print(f"[clean/no-match] {file}")
