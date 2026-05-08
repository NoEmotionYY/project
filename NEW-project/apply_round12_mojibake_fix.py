# -*- coding: utf-8 -*-
"""
Apply Round12 mojibake-only fixes to NEW-project/server.js and NEW-project/src/server.js.
Run from repository root or pass NEW-project path as first argument:
  python apply_round12_mojibake_fix.py NEW-project
The script only replaces exact mojibake fragments listed/derived from CODEX_ROUND12_MOJIBAKE_SCAN.md.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('NEW-project')
targets = [root / 'server.js', root / 'src' / 'server.js']

replacements = {
    '鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API': '职责: WebRTC 收流、RTSP 拉流、抽帧、AI 技能调用、SSE 推送、HTTPS API',
    '鍚姩璇婃柇鏃ュ織缁撴潫': '启动诊断日志结束',
    '鍚姩璇婃柇鏃ュ織': '启动诊断日志',
    '浣跨敤 .env FFMPEG_PATH': '使用 .env FFMPEG_PATH',
    '浣跨敤 npm 鎹嗙粦璺緞': '使用 npm 捆绑路径',
    '鍥為€€鍒扮郴缁?PATH': '回退到系统 PATH',
    '浣跨敤绯荤粺 PATH 涓殑 ffmpeg': '使用系统 PATH 中的 ffmpeg',
    '姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織锛氭寜鎽勫儚澶?ID 鍒嗙洰褰曪紝姣忓ぉ涓€涓?.jsonl 鏂囦欢': '每个摄像头的 JSON 分析日志：按摄像头 ID 分目录，每天一个 .jsonl 文件',
    '姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織': '每个摄像头的 JSON 分析日志',
    '鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?': '加载 AI 技能（通过技能管理器）',
    '鍚戝悗鍏煎锛屼繚鐣欏紩鐢?': '向后兼容，保留引用',
    '鍏ㄥ眬鐘舵€?': '全局状态',
    '绛夊緟鍒嗘瀽...': '等待分析...',
    '澶氭憚鍍忓ご绠＄悊': '多摄像头管理',
    '闇€瑕佹湁鏁堢殑 RTSP 鍦板潃': '需要有效的 RTSP 地址',
    '淇濆瓨澶辫触': '保存失败',
    '宸叉柇寮€': '已断开',
    '姝ｅ湪杩炴帴 RTSP 娴?..': '正在连接 RTSP 流...',
    '姝ｅ湪杩炴帴': '正在连接',
    '甯ц浆鎹㈤敊璇?': '帧转换错误',
    '鍚姩澶辫触': '启动失败',
    '寮傚父閫€鍑?': '异常退出',
    '閫€鍑?': '退出',
    '鏈煡閿欒': '未知错误',
    '杩炴帴宸叉柇寮€': '连接已断开',
    '杩炴帴瓒呮椂锛?0绉掓棤甯э級': '连接超时（30秒无帧）',
    '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘': '连接超时，请检查 RTSP 地址是否正确',
    '鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級': '排除虚拟网卡（VMware、Mihomo VPN 等）',
    '娴嬭瘯/VPN 缃戞': '测试/VPN 网段',
    '鎺掑簭锛氱湡瀹炲眬鍩熺綉 IP 鍦ㄥ墠锛?27.0.0.1 鍦ㄥ悗': '排序：真实局域网 IP 在前，127.0.0.1 在后',
    '璀︽姤璇︽儏': '警报详情',
    '鎻愬彇姣忎釜鎶€鑳界殑鍘熷杩斿洖鏂囨湰': '提取每个技能的原始返回文本',
    '鎽勫儚澶存棩蹇梋 鍐欏叆澶辫触': '摄像头日志] 写入失败',
    '瑙嗛褰曞埗绠＄悊': '视频录制管理',
    '姣?10 鍒嗛挓鍒嗘涓€涓枃浠?': '每 10 分钟分段一个文件',
    'MKV 鏄祦寮忓鍣紝涓嶉渶瑕?movflags锛岃繘绋嬭 kill 涔熻兘姝ｅ父鎾斁': 'MKV 是流式容器，不需要 movflags，进程被 kill 也能正常播放',
    '褰曞埗': '录制',
    '寮€濮嬪綍鍒?': '开始录制',
    '缁?FFmpeg 鏈€澶?10 绉掕嚜鐒跺畬鎴愮紪鐮佸拰鍐欏叆 moov锛屼笉瑕佹彁鍓?kill': '给 FFmpeg 最多 10 秒自然完成编码和写入 moov，不要提前 kill',
    '鍐欏叆甯э紝澶勭悊 backpressure': '写入帧，处理 backpressure',
    '缂撳啿鍖烘弧锛岀瓑 drain 鍚庡啀鎭㈠锛屼絾杩欓噷鐩存帴璺宠繃鏈抚鍗冲彲': '缓冲区满，等 drain 后再恢复，但这里直接跳过本帧即可',
    '瑙嗛甯у鐞?(WebRTC)': '视频帧处理 (WebRTC)',
    'AI 瀹氭椂鍒嗘瀽': 'AI 定时分析',
    '妫€娴嬪埌瀹夊叏椋庨櫓': '检测到安全风险',
    'AI鍒嗘瀽鎴愬姛': 'AI分析成功',
    '鑰楁椂': '耗时',
    'CORS锛氭敮鎸?nginx 鐙珛閮ㄧ讲鐨勫墠绔法鍩熻闂?': 'CORS：支持 nginx 独立部署的前端跨域访问',
    '濡傞渶闄愬埗鐗瑰畾鍩熷悕锛岃缃幆澧冨彉閲?': '如需限制特定域名，设置环境变量',
    '淇′护': '信令',
    '鏀跺埌鍓嶇 offer': '收到前端 offer',
    '鍒嗛厤鎽勫儚澶?': '分配摄像头',
    '杩炴帴鐘舵€?': '连接状态',
    'ICE 鏀堕泦鐘舵€?': 'ICE 收集状态',
    'ICE 鐘舵€?': 'ICE 状态',
    '鎴愬姛': '成功',
    '绛夊緟 ICE gathering 瀹屾垚锛岀‘淇?answer 鍖呭惈瀹屾暣鐨?candidates': '等待 ICE gathering 完成，确保 answer 包含完整的 candidates',
    '5 绉掑厹搴曪細鍗充娇娌℃敹鍒?complete锛屼篃杩斿洖宸叉湁 candidates': '5 秒兜底：即使没收到 complete，也返回已有 candidates',
    '杩斿洖 answer, candidates 宸插寘鍚?': '返回 answer, candidates 已包含',
    '娴嬭瘯椤甸潰锛氫笂浼犲浘鐗囧尯鍩熻繘琛?AI 鍒嗘瀽': '测试页面：上传图片区域进行 AI 分析',
    '缂哄皯 imageBase64 鍙傛暟': '缺少 imageBase64 参数',
    '娴嬭瘯鍒嗘瀽': '测试分析',
    '鏀跺埌鍥剧墖锛屽紑濮嬭皟鐢?AI 鎶€鑳?..': '收到图片，开始调用 AI 技能...',
    '瀹屾垚': '完成',
    '閿欒': '错误',
    'RTSP 鎷夋祦绠＄悊锛堟棫鐗堝吋瀹?- 鎿嶄綔鍥哄畾 camera 鎴?webrtc 鎽勫儚澶达級': 'RTSP 拉流管理（旧版兼容 - 操作固定 camera 或 webrtc 摄像头）',
    '鏃х増鍏煎 - 鍚姩 RTSP 娴侊紙瑕嗙洊 webrtc 鎽勫儚澶翠负 rtsp 妯″紡锛?': '旧版兼容 - 启动 RTSP 流（覆盖 webrtc 摄像头为 rtsp 模式）',
    'RTSP API 璺敱锛堟棫鐗堝吋瀹癸級': 'RTSP API 路由（旧版兼容）',
    'RTSP 娴佸凡鏂紑': 'RTSP 流已断开',
    '鎶€鑳界鐞?API (v2 - 澶氭妧鑳?+ 寮€鍏?+ 鏂囦欢鍔犺浇)': '技能管理 API (v2 - 多技能 + 开关 + 文件加载)',
    '鍒囨崲鎶€鑳藉惎鐢?绂佺敤': '切换技能启用/禁用',
    '缂哄皯 skill 鍙傛暟': '缺少 skill 参数',
    '缂哄皯 enabled 鍙傛暟 (boolean)': '缺少 enabled 参数 (boolean)',
    '鎵弿褰曞埗鐩綍锛岃繑鍥炴墍鏈夋憚鍍忓ご锛堝惈褰曞埗鏂囦欢涓庣姸鎬侊級': '扫描录制目录，返回所有摄像头（含录制文件与状态）',
    '鏀堕泦鎵€鏈夊凡鐭ユ憚鍍忓ご': '收集所有已知摄像头',
    '鏀堕泦鏈夊綍鍒舵枃浠剁殑鎽勫儚澶达紙鍗充娇宸插垹闄わ級': '收集有录制文件的摄像头（即使已删除）',
    '鍒犻櫎褰曞埗鏂囦欢': '删除录制文件',
    '鎻愪緵褰曞埗鏂囦欢涓嬭浇/鎾斁锛堢洿鎺ヨ鍙栨枃浠讹級': '提供录制文件下载/播放（直接读取文件）',
    '鐩戝惉鏉ヨ嚜 Electron 涓昏繘绋嬬殑 IPC 娑堟伅锛堝綋閫氳繃 fork 鍚姩鏃讹級': '监听来自 Electron 主进程的 IPC 消息（当通过 fork 启动时）',
}

for target in targets:
    if not target.exists():
        print(f'SKIP missing: {target}')
        continue
    text = target.read_text(encoding='utf-8-sig')
    original = text
    for old, new in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
        text = text.replace(old, new)
    if text != original:
        target.write_text(text, encoding='utf-8')
        print(f'UPDATED {target}')
    else:
        print(f'NOCHANGE {target}')
