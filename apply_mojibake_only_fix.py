#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Round12/后续乱码精确修复脚本。
用法：python tools/apply_mojibake_only_fix.py NEW-project
只替换已知乱码片段；不会格式化、不会重写非乱码代码。
"""
from pathlib import Path
import sys, re

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('NEW-project')

REPLACEMENTS = {
    'server.js': {
        '* 鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API': '* 职责: WebRTC 收流、RTSP 拉流、抽帧、AI 技能调用、SSE 推送、HTTPS API',
        '// ========== 鍚姩璇婃柇鏃ュ織 ==========': '// ========== 启动诊断日志 ==========',
        '// ========== 鍚姩璇婃柇鏃ュ織缁撴潫 ==========': '// ========== 启动诊断日志结束 ==========',
        "console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH);": "console.log('[ffmpeg] 使用 npm 绑定路径:', FFMPEG_PATH);",
        "FFMPEG_PATH = 'ffmpeg'; // 鍥為€€鍒扮郴缁?PATH": "FFMPEG_PATH = 'ffmpeg'; // 回退到系统 PATH",
        "console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg');": "console.log('[ffmpeg] 使用系统 PATH 中的 ffmpeg');",
        "const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織": "const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 每个摄像头的 JSON 分析日志",
        '// 鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?': '// 加载 AI 技能（通过技能管理器）',
        'let aiSkill; // 鍚戝悗鍏煎锛屼繚鐣欏紩鐢?': 'let aiSkill; // 向后兼容，保留引用',
        '// 鍏ㄥ眬鐘舵€?': '// 全局状态',
        '// 澶氭憚鍍忓ご绠＄悊': '// 多摄像头管理',
        "throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃');": "throw new Error('需要有效的 RTSP 地址');",
        "console.warn('[camera-config] 淇濆瓨澶辫触:', err.message);": "console.warn('[camera-config] 保存失败:', err.message);",
        "console.log(`[RTSP:${id}] 宸叉柇寮€`);": "console.log(`[RTSP:${id}] 已断开`);",
        "console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`);": "console.log(`[RTSP:${id}] 正在连接: ${maskCameraUrl(url)}`);",
        "console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message);": "console.error(`[RTSP:${id}] 帧转换错误`, err.message);",
        "cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`;": "cam.error = `ffmpeg 启动失败: ${err.message}`;",
        "console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`);": "console.log(`[RTSP:${id}] 退出 code=${code} signal=${signal}`);",
        "? `ffmpeg 寮傚父閫€鍑?code=${code}): ${stderrBuffer.trim().split('\\n').pop() || '鏈煡閿欒'}`": "? `ffmpeg 异常退出 code=${code}): ${stderrBuffer.trim().split('\\n').pop() || '未知错误'}`",
        ": '杩炴帴宸叉柇寮€';": ": '连接已断开';",
        "console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`);": "console.error(`[RTSP:${id}] 连接超时，20秒无帧`);",
        "cam.error = '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘';": "cam.error = '连接超时，请检查 RTSP 地址是否正确';",
        '// 鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級': '// 排除虚拟网卡（VMware、Mihomo VPN 等）',
        '// 娴嬭瘯/VPN 缃戞': '// 测试/VPN 网段',
        '// 鎺掑簭锛氱湡瀹炲眬鍩熺綉 IP 鍦ㄥ墠锛?27.0.0.1 鍦ㄥ悗': '// 排序：真实局域网 IP 在前，127.0.0.1 在后',
        '璀︽姤璇︽儏': '警报详情',
        '// 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織锛氭寜鎽勫儚澶?ID 鍒嗙洰褰曪紝姣忓ぉ涓€涓?.jsonl 鏂囦欢': '// 每个摄像头的 JSON 分析日志：按摄像头 ID 分目录，每天一个 .jsonl 文件',
        '// 鎻愬彇姣忎釜鎶€鑳界殑鍘熷杩斿洖鏂囨湰': '// 提取每个技能的原始返回文本',
        "console.error('[鎽勫儚澶存棩蹇梋 鍐欏叆澶辫触:', e.message);": "console.error('[摄像头日志] 写入失败:', e.message);",
        '// 瑙嗛褰曞埗绠＄悊': '// 视频录制管理',
        'const RECORD_SEGMENT_MIN = 10; // 姣?10 鍒嗛挓鍒嗘涓€涓枃浠?': 'const RECORD_SEGMENT_MIN = 10; // 每 10 分钟分段一个文件',
        '// MKV 鏄祦寮忓鍣紝涓嶉渶瑕?movflags锛岃繘绋嬭 kill 涔熻兘姝ｅ父鎾斁': '// MKV 是流式容器，不需要 movflags，进程被 kill 也能正常播放',
        '`[褰曞埗:${recordingCamId}] FFmpeg 鍚姩澶辫触:`': '`[录制:${recordingCamId}] FFmpeg 启动失败:`',
        '`[褰曞埗:${recordingCamId}] FFmpeg 寮傚父閫€鍑?code=${code}`': '`[录制:${recordingCamId}] FFmpeg 异常退出 code=${code}`',
        '`[褰曞埗:${recordingCamId}] 寮€濮嬪綍鍒?-> ${filePath}`': '`[录制:${recordingCamId}] 开始录制 -> ${filePath}`',
        '// 缁?FFmpeg 鏈€澶?10 绉掕嚜鐒跺畬鎴愮紪鐮佸拰鍐欏叆 moov锛屼笉瑕佹彁鍓?kill': '// 给 FFmpeg 最多 10 秒自然完成编码和写入 moov，不要提前 kill',
        '// 鍐欏叆甯э紝澶勭悊 backpressure': '// 写入帧，处理 backpressure',
        '// 缂撳啿鍖烘弧锛岀瓑 drain 鍚庡啀鎭㈠锛屼絾杩欓噷鐩存帴璺宠繃鏈抚鍗冲彲': '// 缓冲区满，等 drain 后再恢复，但这里直接跳过本帧即可',
        '// 瑙嗛甯у鐞?(WebRTC)': '// 视频帧处理 (WebRTC)',
        '// AI 瀹氭椂鍒嗘瀽': '// AI 定时分析',
        '妫€娴嬪埌瀹夊叏椋庨櫓': '检测到安全风险',
        '`[AI鍒嗘瀽鎴愬姛] ${timeStr}, 鑰楁椂 ${Date.now() - startTime}ms`': '`[AI分析成功] ${timeStr}, 耗时 ${Date.now() - startTime}ms`',
        '// CORS锛氭敮鎸?nginx 鐙珛閮ㄧ讲鐨勫墠绔法鍩熻闂?': '// CORS：支持 nginx 独立部署的前端跨域访问',
        '// 濡傞渶闄愬埗鐗瑰畾鍩熷悕锛岃缃幆澧冨彉閲?CORS_ORIGIN=https://your-nginx-domain.com': '// 如需限制特定域名，设置环境变量 CORS_ORIGIN=https://your-nginx-domain.com',
        '`[淇′护] 鏀跺埌鍓嶇 offer #${webrtcInstanceId}, 鍒嗛厤鎽勫儚澶? ${camId}`': '`[信令] 收到前端 offer #${webrtcInstanceId}, 分配摄像头 ${camId}`',
        '`[WebRTC:${camId}] 杩炴帴鐘舵€?`': '`[WebRTC:${camId}] 连接状态`',
        '`[WebRTC:${camId}] ICE 鏀堕泦鐘舵€?`': '`[WebRTC:${camId}] ICE 收集状态`',
        "console.log('[淇′护] setRemoteDescription 鎴愬姛');": "console.log('[信令] setRemoteDescription 成功');",
        "console.log('[淇′护] createAnswer 鎴愬姛');": "console.log('[信令] createAnswer 成功');",
        "console.log('[淇′护] setLocalDescription 鎴愬姛, ICE 鐘舵€?', pc.iceGatheringState);": "console.log('[信令] setLocalDescription 成功, ICE 状态', pc.iceGatheringState);",
        '// 绛夊緟 ICE gathering 瀹屾垚锛岀‘淇?answer 鍖呭惈瀹屾暣鐨?candidates': '// 等待 ICE gathering 完成，确保 answer 包含完整的 candidates',
        '// 5 绉掑厹搴曪細鍗充娇娌℃敹鍒?complete锛屼篃杩斿洖宸叉湁 candidates': '// 5 秒兜底：即使没收到 complete，也返回已有 candidates',
        "console.log('[淇′护] 杩斿洖 answer, candidates 宸插寘鍚?', pc.localDescription.sdp.includes('candidate'));": "console.log('[信令] 返回 answer, candidates 已包含?', pc.localDescription.sdp.includes('candidate'));",
        '// 娴嬭瘯椤甸潰锛氫笂浼犲浘鐗囧尯鍩熻繘琛?AI 鍒嗘瀽': '// 测试页面：上传图片区域进行 AI 分析',
        "return res.status(400).json({ error: '缂哄皯 imageBase64 鍙傛暟' });": "return res.status(400).json({ error: '缺少 imageBase64 参数' });",
        "console.log('[娴嬭瘯鍒嗘瀽] 鏀跺埌鍥剧墖锛屽紑濮嬭皟鐢?AI 鎶€鑳?..');": "console.log('[测试分析] 收到图片，开始调用 AI 技能...');",
        '`[娴嬭瘯鍒嗘瀽] 瀹屾垚锛岃€楁椂 ${Date.now() - startTime}ms`': '`[测试分析] 完成，耗时 ${Date.now() - startTime}ms`',
        "console.error('[娴嬭瘯鍒嗘瀽] 閿欒:', e.message);": "console.error('[测试分析] 错误:', e.message);",
        '// 澶氭憚鍍忓ご绠＄悊 API': '// 多摄像头管理 API',
        '// RTSP 鎷夋祦绠＄悊锛堟棫鐗堝吋瀹?- 鎿嶄綔鍥哄畾 camera 鎴?webrtc 鎽勫儚澶达級': '// RTSP 拉流管理（旧版兼容 - 操作固定 camera 或 webrtc 摄像头）',
        '* 鏃х増鍏煎 - 鍚姩 RTSP 娴侊紙瑕嗙洊 webrtc 鎽勫儚澶翠负 rtsp 妯″紡锛? */': '* 旧版兼容 - 启动 RTSP 流（覆盖 webrtc 摄像头为 rtsp 模式） */',
        '// RTSP API 璺敱锛堟棫鐗堝吋瀹癸級': '// RTSP API 路由（旧版兼容）',
        "res.json({ success: true, message: '姝ｅ湪杩炴帴 RTSP 娴?..', ...getRtspInfo() });": "res.json({ success: true, message: '正在连接 RTSP 流...', ...getRtspInfo() });",
        "res.json({ success: true, message: 'RTSP 娴佸凡鏂紑', ...getRtspInfo() });": "res.json({ success: true, message: 'RTSP 流已断开', ...getRtspInfo() });",
        '// 鎶€鑳界鐞?API (v2 - 澶氭妧鑳?+ 寮€鍏?+ 鏂囦欢鍔犺浇)': '// 技能管理 API (v2 - 多技能 + 开关 + 文件加载)',
        '// 鍒囨崲鎶€鑳藉惎鐢?绂佺敤': '// 切换技能启用/禁用',
        "return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' });": "return res.status(400).json({ error: '缺少 skill 参数' });",
        "return res.status(400).json({ error: '缂哄皯 enabled 鍙傛暟 (boolean)' });": "return res.status(400).json({ error: '缺少 enabled 参数 (boolean)' });",
        '// 鎵弿褰曞埗鐩綍锛岃繑鍥炴墍鏈夋憚鍍忓ご锛堝惈褰曞埗鏂囦欢涓庣姸鎬侊級': '// 扫描录制目录，返回所有摄像头（含录制文件与状态）',
        '// 鏀堕泦鎵€鏈夊凡鐭ユ憚鍍忓ご': '// 收集所有已知摄像头',
    },
    'html/dashboard.html': {
        '濞佽儊鎰熺煡涓\ue15e績': '威胁感知中心',
        '涓荤晫闈?/a>': '主界面</a>',
        '浜嬩欢涓\ue15e績': '事件中心',
        '妫€娴嬮厤缃?/a>': '检测配置</a>',
        '褰曞儚': '录像',
        '鎶€鑳界\ue178鐞?/button>': '技能管理</button>',
        '瀹炴椂鐢婚潰': '实时画面',
        '浣跨敤 CYPHER 褰撳墠甯ф帴鍙ｅ埛鏂帮紝涓嶅惎鐢?MJPEG 閾捐矾銆?/div>': '使用 CYPHER 当前帧接口刷新，不启用 MJPEG 链路。</div>',
        '褰撳墠鎽勫儚澶寸敾闈?>': '当前摄像头画面">',
        '绛夊緟鎽勫儚澶村抚': '等待摄像头帧',
        '绛夊緟鎽勫儚澶村抚鎴?AI 鍒嗘瀽缁撴灉銆?/div>': '等待摄像头帧或 AI 分析结果。</div>',
        '鏈€杩?20 鏉″憡璀?/div>': '最近 20 条告警</div>',
        '楂樺嵄': '高危', '璀﹀憡': '警告', '淇℃伅': '信息',
        '鍛婅\ue11f浜嬩欢': '告警事件', '鏌ョ湅蹇\ue0b2収': '查看快照',
        '鏆傛棤瀹炴椂鍛婅\ue11f': '暂无实时告警',
        '妫€娴嬪埌椋庨櫓': '检测到风险',
        '姝ｅ湪璇诲彇鎶€鑳藉垪琛?..': '正在读取技能列表...',
        '鎶€鑳藉垪琛ㄨ\ue1f0鍙栧け璐ワ細': '技能列表读取失败：',
        '鏆傛棤鎻忚堪': '暂无描述',
        '绂佺敤': '禁用', '鍚\ue1c8敤': '启用',
    },
    'html/desktop-capture.html': {
        '妗岄潰鎹曡幏鎺ㄦ祦': '桌面捕获推流',
        '鐪熻\ue5fb鐪艰皟璇曞伐鍏?': '真视眼调试工具',
        '灏嗗睆骞曘€佺獥鍙ｆ垨娴忚\ue5cd鍣ㄦ爣绛鹃〉浣滀负璋冭瘯鎽勫儚澶存帹閫佸埌鐩戞帶绯荤粺': '将屏幕、窗口或浏览器标签页作为调试摄像头推送到监控系统',
        '鐐瑰嚮寮€濮嬫崟鑾蜂互閫夋嫨灞忓箷婧?': '点击开始捕获以选择屏幕源',
        '鎺ㄦ祦涓?': '推流中',
        '寮€濮嬫崟鑾峰苟鎺ㄦ祦': '开始捕获并推流',
        '浣跨敤鎻愮ず': '使用提示',
        '鏈\ue041繛鎺?': '未连接',
        '鍑嗗\ue620灏辩华': '准备就绪',
    },
    'html/webrtc-client.html': {
        'AI 鎽勫儚澶存帹娴佺\ue041': 'AI 摄像头推流端',
        'AI 鎽勫儚澶存帹娴?': 'AI 摄像头推流',
        '鎽勫儚澶存湭鍚\ue1c8姩': '摄像头未启动',
        '鐐瑰嚮涓嬫柟鎸夐挳寮€濮嬫帹娴?': '点击下方按钮开始推流',
        '寮€濮嬫帹娴?': '开始推流',
        '鏈\ue041繛鎺?': '未连接',
        '鍑嗗\ue620灏辩华锛岀瓑寰呰繛鎺?..': '准备就绪，等待连接...',
        '姝ｅ湪鑾峰彇鏈嶅姟鍣ㄤ俊鎭?..': '正在获取服务器信息...',
    },
}
# server.js and src/server.js same content most of the time
REPLACEMENTS['src/server.js'] = REPLACEMENTS['server.js']

MOJI_RE = re.compile(r'[鎽勫儚澶存帹娴佺寮€濮嬫崟鑾風湅姝ｅ湪杩炴帴璀︽姤鍒嗘瀽褰曞埗瑙嗛妗岄潰鐪熻鐪艰皟璇曞伐鍏锋棤瀹€]+')

def apply_file(rel, mapping):
    path = ROOT / rel
    if not path.exists():
        print(f'[skip] {rel} not found')
        return False
    text = path.read_text(encoding='utf-8')
    old = text
    for src, dst in sorted(mapping.items(), key=lambda kv: len(kv[0]), reverse=True):
        text = text.replace(src, dst)
    if text != old:
        backup = path.with_suffix(path.suffix + '.round12bak')
        if not backup.exists():
            backup.write_text(old, encoding='utf-8')
        path.write_text(text, encoding='utf-8')
        print(f'[fixed] {rel}')
        return True
    print(f'[clean/no-match] {rel}')
    return False

def scan_remaining():
    targets = ['server.js','src/server.js','html/dashboard.html','html/desktop-capture.html','html/webrtc-client.html']
    print('\n[remaining suspicious lines]')
    any_hit=False
    for rel in targets:
        p=ROOT/rel
        if not p.exists(): continue
        for i,line in enumerate(p.read_text(encoding='utf-8', errors='ignore').splitlines(),1):
            if MOJI_RE.search(line):
                print(f'{rel}:{i}: {line[:220]}')
                any_hit=True
    if not any_hit:
        print('未发现脚本规则内的典型乱码。')

for rel, mapping in REPLACEMENTS.items():
    apply_file(rel, mapping)
scan_remaining()
