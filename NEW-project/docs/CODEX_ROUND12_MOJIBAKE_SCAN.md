# Round12-lite 中文乱码只读扫描报告

## 1. 扫描结论

- 是否发现乱码：是。
- 统计口径：已排除 `docs/` 文件夹中的乱码情况。
- 命中文件数：4 个。
- 命中总数：163 条。
- 严重程度统计：P0 2 条，P1 40 条，P2 0 条，P3 121 条。
- 乱码主要集中：
- server.js: 74 条
- src/server.js: 74 条
- html/desktop-capture.html: 9 条
- html/webrtc-client.html: 6 条
- 是否需要后续修复：需要，优先处理页面 title/按钮/状态提示以及运行时日志文案。
- 本轮是否修改业务代码：否。

疑似原因：

- 本报告已按用户要求排除 `docs/` 文件夹中的乱码命中。
- 非 docs 命中仍呈现典型 UTF-8 被 GBK/CP936 错解后的 mojibake，例如 `鎽`、`勫`、`涓`、`€`。
- 本轮只调整扫描口径，不做自动编码修复。

轻量检查沿用 Round12：

- `node --check scripts/ensure-test-cert.js`：通过。
- `node --check src/server.js`：通过。
- `node --check server.js`：通过。

## 2. 扫描范围

扫描范围：

- `html/`
- `src/`
- `skills/`
- `scripts/`
- `tests/`
- `README.md`
- `RUN_NEW_PROJECT.md`
- `MANIFEST.md`
- `.env.example`
- `package.json`
- `server.js`
- `dev.js`
- `electron-main.js`

排除范围：

- `docs/`，按用户要求排除文档乱码情况
- `node_modules/`
- `.git/`
- `bin/`
- `data/`
- `logs/`
- `recordings/`
- `nginx/conf/cert.pem`
- `nginx/conf/key.pem`
- `.env`
- 图片、视频、模型、数据库、二进制文件
- `package-lock.json`

## 3. 乱码位置汇总

| 序号 | 文件 | 行号 | 乱码片段 | 命中规则 | 严重程度 | 建议 |
|---|---|---|---|---|---|---|
| 1 | html/desktop-capture.html | 6 | <title>妗岄潰鎹曡幏鎺ㄦ祦 - 鐪熻鐪艰皟璇曞伐鍏?/title> | 璇 | P0 | 建议后续修复 |
| 2 | html/desktop-capture.html | 165 | <p>灏嗗睆骞曘€佺獥鍙ｆ垨娴忚鍣ㄦ爣绛鹃〉浣滀负璋冭瘯鎽勫儚澶存帹閫佸埌鐩戞帶绯荤粺</p> | 鐩 | P1 | 建议后续修复 |
| 3 | html/desktop-capture.html | 171 | <div>鐐瑰嚮寮€濮嬫崟鑾蜂互閫夋嫨灞忓箷婧?/div> | € | P1 | 建议后续修复 |
| 4 | html/desktop-capture.html | 174 | <div class="rec-badge" id="rec-badge"><i class="fa fa-circle"></i> 鎺ㄦ祦涓?/div> | 涓 | P1 | 建议后续修复 |
| 5 | html/desktop-capture.html | 184 | <i class="fa fa-play"></i> 寮€濮嬫崟鑾峰苟鎺ㄦ祦 | € | P3 | 疑似误报 |
| 6 | html/desktop-capture.html | 190 | <li>鎹曡幏鐨勬闈㈢敾闈細娉ㄥ唽涓恒€屾闈㈡崟鑾枫€嶆憚鍍忓ご锛屽彲鍦?monitor 闈㈡澘鍒囨崲鏌ョ湅</li> | 涓 | P3 | 疑似误报 |
| 7 | html/desktop-capture.html | 191 | <li>閫夋嫨銆屾暣涓睆骞曘€嶅彲鎹曡幏鍏ㄥ睆锛岄€夋嫨銆岀獥鍙ｃ€嶅彲鎹曡幏鍗曚釜搴旂敤</li> | 涓 | P3 | 疑似误报 |
| 8 | html/desktop-capture.html | 192 | <li>鎺ㄦ祦鍚庣敾闈細瀹炴椂浼犺緭鍒板悗绔紝AI 鎶€鑳戒細瀵瑰叾杩涜鍒嗘瀽</li> | 杩 | P3 | 疑似误报 |
| 9 | html/desktop-capture.html | 193 | <li>鍋滄鎺ㄦ祦鍚庢憚鍍忓ご浼氳嚜鍔ㄦ柇寮€锛屽彲鍦?monitor 涓垹闄?/li> | 涓 | P3 | 疑似误报 |
| 10 | html/webrtc-client.html | 10 | <title>AI 鎽勫儚澶存帹娴佺</title> | 鎽 | P0 | 建议后续修复 |
| 11 | html/webrtc-client.html | 246 | /* 绔栧睆鏃惰棰戞柟鍚戜紭鍖?*/ | 鍚 | P3 | 疑似误报 |
| 12 | html/webrtc-client.html | 282 | <span>AI 鎽勫儚澶存帹娴?/span> | 鎽 | P1 | 建议后续修复 |
| 13 | html/webrtc-client.html | 298 | <p>鎽勫儚澶存湭鍚姩</p> | 鍚 | P1 | 建议后续修复 |
| 14 | html/webrtc-client.html | 299 | <p class="hint">鐐瑰嚮涓嬫柟鎸夐挳寮€濮嬫帹娴?/p> | 涓 | P1 | 建议后续修复 |
| 15 | html/webrtc-client.html | 314 | <i class="fa-solid fa-play"></i> 寮€濮嬫帹娴? </button> | 帹 | P1 | 建议后续修复 |
| 16 | server.js | 3 | * 鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API | 銆 | P3 | 疑似误报 |
| 17 | server.js | 23 | // ========== 鍚姩璇婃柇鏃ュ織 ========== | 鍚 | P3 | 疑似误报 |
| 18 | server.js | 48 | // ========== 鍚姩璇婃柇鏃ュ織缁撴潫 ========== | 鍚 | P3 | 疑似误报 |
| 19 | server.js | 68 | console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH); |  | P3 | 疑似误报 |
| 20 | server.js | 70 | FFMPEG_PATH = 'ffmpeg'; // 鍥為€€鍒扮郴缁?PATH | € | P3 | 疑似误报 |
| 21 | server.js | 71 | console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg'); | 涓 | P3 | 疑似误报 |
| 22 | server.js | 80 | const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織 | 鎽 | P3 | 疑似误报 |
| 23 | server.js | 116 | // 鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?// ========================================== | € | P3 | 疑似误报 |
| 24 | server.js | 118 | let aiSkill; // 鍚戝悗鍏煎锛屼繚鐣欏紩鐢? | 鍚 | P3 | 疑似误报 |
| 25 | server.js | 137 | // 鍏ㄥ眬鐘舵€?// ========================================== | € | P3 | 疑似误报 |
| 26 | server.js | 165 | // 澶氭憚鍍忓ご绠＄悊 | 澶 | P3 | 疑似误报 |
| 27 | server.js | 181 | throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃'); | € | P3 | 疑似误报 |
| 28 | server.js | 254 | console.warn('[camera-config] 淇濆瓨澶辫触:', err.message); | 澶 | P3 | 疑似误报 |
| 29 | server.js | 317 | console.log(`[RTSP:${id}] 宸叉柇寮€`); | € | P3 | 疑似误报 |
| 30 | server.js | 334 | console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`); | 杩 | P3 | 疑似误报 |
| 31 | server.js | 386 | console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message); | 璇 | P3 | 疑似误报 |
| 32 | server.js | 400 | cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`; | 鍚 | P3 | 疑似误报 |
| 33 | server.js | 406 | console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`); | € | P3 | 疑似误报 |
| 34 | server.js | 410 | ? `ffmpeg 寮傚父閫€鍑?code=${code}): ${stderrBuffer.trim().split('\n').pop() \|\| '鏈煡閿欒'}` | € | P3 | 疑似误报 |
| 35 | server.js | 411 | : '杩炴帴宸叉柇寮€'; | 杩 | P3 | 疑似误报 |
| 36 | server.js | 419 | console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`); | 杩 | P3 | 疑似误报 |
| 37 | server.js | 421 | cam.error = '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘'; | 杩 | P3 | 疑似误报 |
| 38 | server.js | 450 | // 鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級 | 銆 | P3 | 疑似误报 |
| 39 | server.js | 455 | if (addr.startsWith('198.18.') \|\| addr.startsWith('198.19.')) continue; // 娴嬭瘯/VPN 缃戞 | 娴 | P3 | 疑似误报 |
| 40 | server.js | 461 | // 鎺掑簭锛氱湡瀹炲眬鍩熺綉 IP 鍦ㄥ墠锛?27.0.0.1 鍦ㄥ悗 | 瀹 | P3 | 疑似误报 |
| 41 | server.js | 476 | if (alertDetails?.length) line += `璀︽姤璇︽儏: ${alertDetails.join(', ')}\n`; | 璇 | P3 | 疑似误报 |
| 42 | server.js | 481 | // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織锛氭寜鎽勫儚澶?ID 鍒嗙洰褰曪紝姣忓ぉ涓€涓?.jsonl 鏂囦欢 | 涓 | P3 | 疑似误报 |
| 43 | server.js | 491 | // 鎻愬彇姣忎釜鎶€鑳界殑鍘熷杩斿洖鏂囨湰 | 鏂 | P3 | 疑似误报 |
| 44 | server.js | 512 | console.error('[鎽勫儚澶存棩蹇梋 鍐欏叆澶辫触:', e.message); | 鎽 | P3 | 疑似误报 |
| 45 | server.js | 517 | // 瑙嗛褰曞埗绠＄悊 | 瑙 | P3 | 疑似误报 |
| 46 | server.js | 521 | const RECORD_SEGMENT_MIN = 10; // 姣?10 鍒嗛挓鍒嗘涓€涓枃浠?const RECORD_MIN_INTERVAL_MS = 1000 / RECORD_FPS; // 鍐欏... | 涓 | P3 | 疑似误报 |
| 47 | server.js | 573 | // MKV 鏄祦寮忓鍣紝涓嶉渶瑕?movflags锛岃繘绋嬭 kill 涔熻兘姝ｅ父鎾斁 | 涓 | P3 | 疑似误报 |
| 48 | server.js | 583 | console.error(`[褰曞埗:${recordingCamId}] FFmpeg 鍚姩澶辫触:`, err.message); | 鍚 | P3 | 疑似误报 |
| 49 | server.js | 588 | console.error(`[褰曞埗:${recordingCamId}] FFmpeg 寮傚父閫€鍑?code=${code}`); | € | P3 | 疑似误报 |
| 50 | server.js | 599 | console.log(`[褰曞埗:${recordingCamId}] 寮€濮嬪綍鍒?-> ${filePath}`); | € | P3 | 疑似误报 |
| 51 | server.js | 614 | // 缁?FFmpeg 鏈€澶?10 绉掕嚜鐒跺畬鎴愮紪鐮佸拰鍐欏叆 moov锛屼笉瑕佹彁鍓?kill | 鎴 | P3 | 疑似误报 |
| 52 | server.js | 645 | // 鍐欏叆甯э紝澶勭悊 backpressure | 澶 | P3 | 疑似误报 |
| 53 | server.js | 649 | // 缂撳啿鍖烘弧锛岀瓑 drain 鍚庡啀鎭㈠锛屼絾杩欓噷鐩存帴璺宠繃鏈抚鍗冲彲 | 杩 | P3 | 疑似误报 |
| 54 | server.js | 726 | // 瑙嗛甯у鐞?(WebRTC) | 瑙 | P3 | 疑似误报 |
| 55 | server.js | 837 | // AI 瀹氭椂鍒嗘瀽 | 瀹 | P3 | 疑似误报 |
| 56 | server.js | 886 | alert_message: result.alert ? `妫€娴嬪埌瀹夊叏椋庨櫓: ${result.alert_details.join('; ')}` : '', | 瀹 | P3 | 疑似误报 |
| 57 | server.js | 907 | console.log(`[AI鍒嗘瀽鎴愬姛] ${timeStr}, 鑰楁椂 ${Date.now() - startTime}ms`); | 鎴 | P3 | 疑似误报 |
| 58 | server.js | 956 | // CORS锛氭敮鎸?nginx 鐙珛閮ㄧ讲鐨勫墠绔法鍩熻闂?// 濡傞渶闄愬埗鐗瑰畾鍩熷悕锛岃缃幆澧冨彉閲?CORS_ORIGIN=https://your-nginx-domain.com | 闂 | P3 | 疑似误报 |
| 59 | server.js | 1021 | console.log(`[淇′护] 鏀跺埌鍓嶇 offer #${webrtcInstanceId}, 鍒嗛厤鎽勫儚澶? ${camId}`); | 鍓 | P3 | 疑似误报 |
| 60 | server.js | 1039 | console.log(`[WebRTC:${camId}] 杩炴帴鐘舵€?`, pc.connectionState); | 杩 | P3 | 疑似误报 |
| 61 | server.js | 1054 | console.log(`[WebRTC:${camId}] ICE 鏀堕泦鐘舵€?`, pc.iceGatheringState); | € | P3 | 疑似误报 |
| 62 | server.js | 1066 | console.log('[淇′护] setRemoteDescription 鎴愬姛'); | 鎴 | P3 | 疑似误报 |
| 63 | server.js | 1069 | console.log('[淇′护] createAnswer 鎴愬姛'); | 鎴 | P3 | 疑似误报 |
| 64 | server.js | 1072 | console.log('[淇′护] setLocalDescription 鎴愬姛, ICE 鐘舵€?', pc.iceGatheringState); | 鎴 | P3 | 疑似误报 |
| 65 | server.js | 1074 | // 绛夊緟 ICE gathering 瀹屾垚锛岀‘淇?answer 鍖呭惈瀹屾暣鐨?candidates | 瀹 | P3 | 疑似误报 |
| 66 | server.js | 1091 | // 5 绉掑厹搴曪細鍗充娇娌℃敹鍒?complete锛屼篃杩斿洖宸叉湁 candidates | 杩 | P3 | 疑似误报 |
| 67 | server.js | 1103 | console.log('[淇′护] 杩斿洖 answer, candidates 宸插寘鍚?', pc.localDescription.sdp.includes('candidate')); | 杩 | P3 | 疑似误报 |
| 68 | server.js | 1222 | // 娴嬭瘯椤甸潰锛氫笂浼犲浘鐗囧尯鍩熻繘琛?AI 鍒嗘瀽 | 椤 | P3 | 疑似误报 |
| 69 | server.js | 1227 | return res.status(400).json({ error: '缂哄皯 imageBase64 鍙傛暟' }); | 缂 | P3 | 疑似误报 |
| 70 | server.js | 1230 | console.log('[娴嬭瘯鍒嗘瀽] 鏀跺埌鍥剧墖锛屽紑濮嬭皟鐢?AI 鎶€鑳?..'); | 娴 | P3 | 疑似误报 |
| 71 | server.js | 1238 | console.log(`[娴嬭瘯鍒嗘瀽] 瀹屾垚锛岃€楁椂 ${Date.now() - startTime}ms`); | 瀹 | P3 | 疑似误报 |
| 72 | server.js | 1242 | console.error('[娴嬭瘯鍒嗘瀽] 閿欒:', e.message); | 娴 | P3 | 疑似误报 |
| 73 | server.js | 1269 | // 澶氭憚鍍忓ご绠＄悊 API | 澶 | P3 | 疑似误报 |
| 74 | server.js | 1383 | // RTSP 鎷夋祦绠＄悊锛堟棫鐗堝吋瀹?- 鎿嶄綔鍥哄畾 camera 鎴?webrtc 鎽勫儚澶达級 | 鎴 | P3 | 疑似误报 |
| 75 | server.js | 1387 | * 鏃х増鍏煎 - 鍚姩 RTSP 娴侊紙瑕嗙洊 webrtc 鎽勫儚澶翠负 rtsp 妯″紡锛? */ | 鍚 | P3 | 疑似误报 |
| 76 | server.js | 1442 | // RTSP API 璺敱锛堟棫鐗堝吋瀹癸級 | 瀹 | P3 | 疑似误报 |
| 77 | server.js | 1449 | res.json({ success: true, message: '姝ｅ湪杩炴帴 RTSP 娴?..', ...getRtspInfo() }); | 杩 | P3 | 疑似误报 |
| 78 | server.js | 1454 | res.json({ success: true, message: 'RTSP 娴佸凡鏂紑', ...getRtspInfo() }); | 鏂 | P3 | 疑似误报 |
| 79 | server.js | 1476 | // 鎶€鑳界鐞?API (v2 - 澶氭妧鑳?+ 寮€鍏?+ 鏂囦欢鍔犺浇) | 鏂 | P3 | 疑似误报 |
| 80 | server.js | 1491 | // 鍒囨崲鎶€鑳藉惎鐢?绂佺敤 | 佺 | P3 | 疑似误报 |
| 81 | server.js | 1496 | return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' }); | 缂 | P3 | 疑似误报 |
| 82 | server.js | 1499 | return res.status(400).json({ error: '缂哄皯 enabled 鍙傛暟 (boolean)' }); | 缂 | P3 | 疑似误报 |
| 83 | server.js | 1517 | return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' }); | 缂 | P3 | 疑似误报 |
| 84 | server.js | 1538 | // 鎵弿褰曞埗鐩綍锛岃繑鍥炴墍鏈夋憚鍍忓ご锛堝惈褰曞埗鏂囦欢涓庣姸鎬侊級 | 涓 | P3 | 疑似误报 |
| 85 | server.js | 1543 | // 1. 鏀堕泦鎵€鏈夊凡鐭ユ憚鍍忓ご | € | P3 | 疑似误报 |
| 86 | server.js | 1547 | // 2. 鏀堕泦鏈夊綍鍒舵枃浠剁殑鎽勫儚澶达紙鍗充娇宸插垹闄わ級 | 浠 | P3 | 疑似误报 |
| 87 | server.js | 1605 | // 鍒犻櫎褰曞埗鏂囦欢 | 鏂 | P3 | 疑似误报 |
| 88 | server.js | 1626 | // 鎻愪緵褰曞埗鏂囦欢涓嬭浇/鎾斁锛堢洿鎺ヨ鍙栨枃浠讹級 | 涓 | P3 | 疑似误报 |
| 89 | server.js | 1739 | // 鐩戝惉鏉ヨ嚜 Electron 涓昏繘绋嬬殑 IPC 娑堟伅锛堝綋閫氳繃 fork 鍚姩鏃讹級 | 涓 | P3 | 疑似误报 |
| 90 | src/server.js | 3 | * 鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API | 銆 | P3 | 疑似误报 |
| 91 | src/server.js | 23 | // ========== 鍚姩璇婃柇鏃ュ織 ========== | 鍚 | P3 | 疑似误报 |
| 92 | src/server.js | 48 | // ========== 鍚姩璇婃柇鏃ュ織缁撴潫 ========== | 鍚 | P3 | 疑似误报 |
| 93 | src/server.js | 68 | console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH); |  | P1 | 建议后续修复 |
| 94 | src/server.js | 70 | FFMPEG_PATH = 'ffmpeg'; // 鍥為€€鍒扮郴缁?PATH | € | P3 | 疑似误报 |
| 95 | src/server.js | 71 | console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg'); | 涓 | P1 | 建议后续修复 |
| 96 | src/server.js | 80 | const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織 | 鎽 | P3 | 疑似误报 |
| 97 | src/server.js | 116 | // 鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?// ========================================== | € | P3 | 疑似误报 |
| 98 | src/server.js | 118 | let aiSkill; // 鍚戝悗鍏煎锛屼繚鐣欏紩鐢? | 鍚 | P3 | 疑似误报 |
| 99 | src/server.js | 137 | // 鍏ㄥ眬鐘舵€?// ========================================== | € | P3 | 疑似误报 |
| 100 | src/server.js | 165 | // 澶氭憚鍍忓ご绠＄悊 | 澶 | P3 | 疑似误报 |
| 101 | src/server.js | 181 | throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃'); | € | P1 | 建议后续修复 |
| 102 | src/server.js | 254 | console.warn('[camera-config] 淇濆瓨澶辫触:', err.message); | 澶 | P1 | 建议后续修复 |
| 103 | src/server.js | 317 | console.log(`[RTSP:${id}] 宸叉柇寮€`); | € | P1 | 建议后续修复 |
| 104 | src/server.js | 334 | console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`); | 杩 | P1 | 建议后续修复 |
| 105 | src/server.js | 386 | console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message); | 璇 | P1 | 建议后续修复 |
| 106 | src/server.js | 400 | cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`; | 鍚 | P1 | 建议后续修复 |
| 107 | src/server.js | 406 | console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`); | € | P1 | 建议后续修复 |
| 108 | src/server.js | 410 | ? `ffmpeg 寮傚父閫€鍑?code=${code}): ${stderrBuffer.trim().split('\n').pop() \|\| '鏈煡閿欒'}` | € | P3 | 疑似误报 |
| 109 | src/server.js | 411 | : '杩炴帴宸叉柇寮€'; | 杩 | P3 | 疑似误报 |
| 110 | src/server.js | 419 | console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`); | 杩 | P1 | 建议后续修复 |
| 111 | src/server.js | 421 | cam.error = '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘'; | 杩 | P3 | 疑似误报 |
| 112 | src/server.js | 450 | // 鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級 | 銆 | P3 | 疑似误报 |
| 113 | src/server.js | 455 | if (addr.startsWith('198.18.') \|\| addr.startsWith('198.19.')) continue; // 娴嬭瘯/VPN 缃戞 | 娴 | P3 | 疑似误报 |
| 114 | src/server.js | 461 | // 鎺掑簭锛氱湡瀹炲眬鍩熺綉 IP 鍦ㄥ墠锛?27.0.0.1 鍦ㄥ悗 | 瀹 | P3 | 疑似误报 |
| 115 | src/server.js | 476 | if (alertDetails?.length) line += `璀︽姤璇︽儏: ${alertDetails.join(', ')}\n`; | 璇 | P1 | 建议后续修复 |
| 116 | src/server.js | 481 | // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織锛氭寜鎽勫儚澶?ID 鍒嗙洰褰曪紝姣忓ぉ涓€涓?.jsonl 鏂囦欢 | 涓 | P3 | 疑似误报 |
| 117 | src/server.js | 491 | // 鎻愬彇姣忎釜鎶€鑳界殑鍘熷杩斿洖鏂囨湰 | 鏂 | P3 | 疑似误报 |
| 118 | src/server.js | 512 | console.error('[鎽勫儚澶存棩蹇梋 鍐欏叆澶辫触:', e.message); | 鎽 | P1 | 建议后续修复 |
| 119 | src/server.js | 517 | // 瑙嗛褰曞埗绠＄悊 | 瑙 | P3 | 疑似误报 |
| 120 | src/server.js | 521 | const RECORD_SEGMENT_MIN = 10; // 姣?10 鍒嗛挓鍒嗘涓€涓枃浠?const RECORD_MIN_INTERVAL_MS = 1000 / RECORD_FPS; // 鍐欏... | 涓 | P3 | 疑似误报 |
| 121 | src/server.js | 573 | // MKV 鏄祦寮忓鍣紝涓嶉渶瑕?movflags锛岃繘绋嬭 kill 涔熻兘姝ｅ父鎾斁 | 涓 | P3 | 疑似误报 |
| 122 | src/server.js | 583 | console.error(`[褰曞埗:${recordingCamId}] FFmpeg 鍚姩澶辫触:`, err.message); | 鍚 | P1 | 建议后续修复 |
| 123 | src/server.js | 588 | console.error(`[褰曞埗:${recordingCamId}] FFmpeg 寮傚父閫€鍑?code=${code}`); | € | P1 | 建议后续修复 |
| 124 | src/server.js | 599 | console.log(`[褰曞埗:${recordingCamId}] 寮€濮嬪綍鍒?-> ${filePath}`); | € | P1 | 建议后续修复 |
| 125 | src/server.js | 614 | // 缁?FFmpeg 鏈€澶?10 绉掕嚜鐒跺畬鎴愮紪鐮佸拰鍐欏叆 moov锛屼笉瑕佹彁鍓?kill | 鎴 | P3 | 疑似误报 |
| 126 | src/server.js | 645 | // 鍐欏叆甯э紝澶勭悊 backpressure | 澶 | P3 | 疑似误报 |
| 127 | src/server.js | 649 | // 缂撳啿鍖烘弧锛岀瓑 drain 鍚庡啀鎭㈠锛屼絾杩欓噷鐩存帴璺宠繃鏈抚鍗冲彲 | 杩 | P3 | 疑似误报 |
| 128 | src/server.js | 726 | // 瑙嗛甯у鐞?(WebRTC) | 瑙 | P3 | 疑似误报 |
| 129 | src/server.js | 837 | // AI 瀹氭椂鍒嗘瀽 | 瀹 | P3 | 疑似误报 |
| 130 | src/server.js | 886 | alert_message: result.alert ? `妫€娴嬪埌瀹夊叏椋庨櫓: ${result.alert_details.join('; ')}` : '', | 瀹 | P1 | 建议后续修复 |
| 131 | src/server.js | 907 | console.log(`[AI鍒嗘瀽鎴愬姛] ${timeStr}, 鑰楁椂 ${Date.now() - startTime}ms`); | 鎴 | P1 | 建议后续修复 |
| 132 | src/server.js | 956 | // CORS锛氭敮鎸?nginx 鐙珛閮ㄧ讲鐨勫墠绔法鍩熻闂?// 濡傞渶闄愬埗鐗瑰畾鍩熷悕锛岃缃幆澧冨彉閲?CORS_ORIGIN=https://your-nginx-domain.com | 闂 | P3 | 疑似误报 |
| 133 | src/server.js | 1021 | console.log(`[淇′护] 鏀跺埌鍓嶇 offer #${webrtcInstanceId}, 鍒嗛厤鎽勫儚澶? ${camId}`); | 鍓 | P1 | 建议后续修复 |
| 134 | src/server.js | 1039 | console.log(`[WebRTC:${camId}] 杩炴帴鐘舵€?`, pc.connectionState); | 杩 | P1 | 建议后续修复 |
| 135 | src/server.js | 1054 | console.log(`[WebRTC:${camId}] ICE 鏀堕泦鐘舵€?`, pc.iceGatheringState); | € | P1 | 建议后续修复 |
| 136 | src/server.js | 1066 | console.log('[淇′护] setRemoteDescription 鎴愬姛'); | 鎴 | P1 | 建议后续修复 |
| 137 | src/server.js | 1069 | console.log('[淇′护] createAnswer 鎴愬姛'); | 鎴 | P1 | 建议后续修复 |
| 138 | src/server.js | 1072 | console.log('[淇′护] setLocalDescription 鎴愬姛, ICE 鐘舵€?', pc.iceGatheringState); | 鎴 | P1 | 建议后续修复 |
| 139 | src/server.js | 1074 | // 绛夊緟 ICE gathering 瀹屾垚锛岀‘淇?answer 鍖呭惈瀹屾暣鐨?candidates | 瀹 | P3 | 疑似误报 |
| 140 | src/server.js | 1091 | // 5 绉掑厹搴曪細鍗充娇娌℃敹鍒?complete锛屼篃杩斿洖宸叉湁 candidates | 杩 | P3 | 疑似误报 |
| 141 | src/server.js | 1103 | console.log('[淇′护] 杩斿洖 answer, candidates 宸插寘鍚?', pc.localDescription.sdp.includes('candidate')); | 杩 | P1 | 建议后续修复 |
| 142 | src/server.js | 1222 | // 娴嬭瘯椤甸潰锛氫笂浼犲浘鐗囧尯鍩熻繘琛?AI 鍒嗘瀽 | 椤 | P3 | 疑似误报 |
| 143 | src/server.js | 1227 | return res.status(400).json({ error: '缂哄皯 imageBase64 鍙傛暟' }); | 缂 | P1 | 建议后续修复 |
| 144 | src/server.js | 1230 | console.log('[娴嬭瘯鍒嗘瀽] 鏀跺埌鍥剧墖锛屽紑濮嬭皟鐢?AI 鎶€鑳?..'); | 娴 | P1 | 建议后续修复 |
| 145 | src/server.js | 1238 | console.log(`[娴嬭瘯鍒嗘瀽] 瀹屾垚锛岃€楁椂 ${Date.now() - startTime}ms`); | 瀹 | P1 | 建议后续修复 |
| 146 | src/server.js | 1242 | console.error('[娴嬭瘯鍒嗘瀽] 閿欒:', e.message); | 娴 | P1 | 建议后续修复 |
| 147 | src/server.js | 1269 | // 澶氭憚鍍忓ご绠＄悊 API | 澶 | P3 | 疑似误报 |
| 148 | src/server.js | 1383 | // RTSP 鎷夋祦绠＄悊锛堟棫鐗堝吋瀹?- 鎿嶄綔鍥哄畾 camera 鎴?webrtc 鎽勫儚澶达級 | 鎴 | P3 | 疑似误报 |
| 149 | src/server.js | 1387 | * 鏃х増鍏煎 - 鍚姩 RTSP 娴侊紙瑕嗙洊 webrtc 鎽勫儚澶翠负 rtsp 妯″紡锛? */ | 鍚 | P3 | 疑似误报 |
| 150 | src/server.js | 1442 | // RTSP API 璺敱锛堟棫鐗堝吋瀹癸級 | 瀹 | P3 | 疑似误报 |
| 151 | src/server.js | 1449 | res.json({ success: true, message: '姝ｅ湪杩炴帴 RTSP 娴?..', ...getRtspInfo() }); | 杩 | P1 | 建议后续修复 |
| 152 | src/server.js | 1454 | res.json({ success: true, message: 'RTSP 娴佸凡鏂紑', ...getRtspInfo() }); | 鏂 | P1 | 建议后续修复 |
| 153 | src/server.js | 1476 | // 鎶€鑳界鐞?API (v2 - 澶氭妧鑳?+ 寮€鍏?+ 鏂囦欢鍔犺浇) | 鏂 | P3 | 疑似误报 |
| 154 | src/server.js | 1491 | // 鍒囨崲鎶€鑳藉惎鐢?绂佺敤 | 佺 | P3 | 疑似误报 |
| 155 | src/server.js | 1496 | return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' }); | 缂 | P1 | 建议后续修复 |
| 156 | src/server.js | 1499 | return res.status(400).json({ error: '缂哄皯 enabled 鍙傛暟 (boolean)' }); | 缂 | P1 | 建议后续修复 |
| 157 | src/server.js | 1517 | return res.status(400).json({ error: '缂哄皯 skill 鍙傛暟' }); | 缂 | P1 | 建议后续修复 |
| 158 | src/server.js | 1538 | // 鎵弿褰曞埗鐩綍锛岃繑鍥炴墍鏈夋憚鍍忓ご锛堝惈褰曞埗鏂囦欢涓庣姸鎬侊級 | 涓 | P3 | 疑似误报 |
| 159 | src/server.js | 1543 | // 1. 鏀堕泦鎵€鏈夊凡鐭ユ憚鍍忓ご | € | P3 | 疑似误报 |
| 160 | src/server.js | 1547 | // 2. 鏀堕泦鏈夊綍鍒舵枃浠剁殑鎽勫儚澶达紙鍗充娇宸插垹闄わ級 | 浠 | P3 | 疑似误报 |
| 161 | src/server.js | 1605 | // 鍒犻櫎褰曞埗鏂囦欢 | 鏂 | P3 | 疑似误报 |
| 162 | src/server.js | 1626 | // 鎻愪緵褰曞埗鏂囦欢涓嬭浇/鎾斁锛堢洿鎺ヨ鍙栨枃浠讹級 | 涓 | P3 | 疑似误报 |
| 163 | src/server.js | 1739 | // 鐩戝惉鏉ヨ嚜 Electron 涓昏繘绋嬬殑 IPC 娑堟伅锛堝綋閫氳繃 fork 鍚姩鏃讹級 | 涓 | P3 | 疑似误报 |

## 4. 页面 title 检查

| 文件 | title | 是否乱码 |
|---|---|---|
| html/dashboard.html | CYPHER 威胁感知中心 | 否 |
| html/settings.html | CYPHER 检测配置 | 否 |
| html/events.html | CYPHER 事件中心 | 否 |
| html/recordings.html | 录制管理 - 真視眼 | 否 |
| html/webrtc-client.html | AI 鎽勫儚澶存帹娴佺 | 是 |
| html/desktop-capture.html | 未找到 title | 否 |
| html/monitor.html | CYPHER 主界面跳转 | 否 |

## 5. 疑似误报

以下 P3 命中建议人工确认，不在本轮修复：

- html/desktop-capture.html:184 [€] <i class="fa fa-play"></i> 寮€濮嬫崟鑾峰苟鎺ㄦ祦
- html/desktop-capture.html:190 [涓] <li>鎹曡幏鐨勬闈㈢敾闈細娉ㄥ唽涓恒€屾闈㈡崟鑾枫€嶆憚鍍忓ご锛屽彲鍦?monitor 闈㈡澘鍒囨崲鏌ョ湅</li>
- html/desktop-capture.html:191 [涓] <li>閫夋嫨銆屾暣涓睆骞曘€嶅彲鎹曡幏鍏ㄥ睆锛岄€夋嫨銆岀獥鍙ｃ€嶅彲鎹曡幏鍗曚釜搴旂敤</li>
- html/desktop-capture.html:192 [杩] <li>鎺ㄦ祦鍚庣敾闈細瀹炴椂浼犺緭鍒板悗绔紝AI 鎶€鑳戒細瀵瑰叾杩涜鍒嗘瀽</li>
- html/desktop-capture.html:193 [涓] <li>鍋滄鎺ㄦ祦鍚庢憚鍍忓ご浼氳嚜鍔ㄦ柇寮€锛屽彲鍦?monitor 涓垹闄?/li>
- html/webrtc-client.html:246 [鍚] /* 绔栧睆鏃惰棰戞柟鍚戜紭鍖?*/
- server.js:3 [銆] * 鑱岃矗: WebRTC 鏀舵祦銆丷TSP 鎷夋祦銆佹娊甯с€丄I 鎶€鑳借皟鐢ㄣ€丼SE 鎺ㄩ€併€丠TTPS API
- server.js:23 [鍚] // ========== 鍚姩璇婃柇鏃ュ織 ==========
- server.js:48 [鍚] // ========== 鍚姩璇婃柇鏃ュ織缁撴潫 ==========
- server.js:68 [] console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH);
- server.js:70 [€] FFMPEG_PATH = 'ffmpeg'; // 鍥為€€鍒扮郴缁?PATH
- server.js:71 [涓] console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg');
- server.js:80 [鎽] const CAMERA_LOG_DIR = path.join(PROJECT_ROOT, 'camera-logs'); // 姣忎釜鎽勫儚澶寸殑 JSON 鍒嗘瀽鏃ュ織
- server.js:116 [€] // 鍔犺浇 AI 鎶€鑳斤紙閫氳繃鎶€鑳界鐞嗗櫒锛?// ==========================================
- server.js:118 [鍚] let aiSkill; // 鍚戝悗鍏煎锛屼繚鐣欏紩鐢?
- server.js:137 [€] // 鍏ㄥ眬鐘舵€?// ==========================================
- server.js:165 [澶] // 澶氭憚鍍忓ご绠＄悊
- server.js:181 [€] throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃');
- server.js:254 [澶] console.warn('[camera-config] 淇濆瓨澶辫触:', err.message);
- server.js:317 [€] console.log(`[RTSP:${id}] 宸叉柇寮€`);
- server.js:334 [杩] console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`);
- server.js:386 [璇] console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message);
- server.js:400 [鍚] cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`;
- server.js:406 [€] console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`);
- server.js:410 [€] ? `ffmpeg 寮傚父閫€鍑?code=${code}): ${stderrBuffer.trim().split('\n').pop() \|\| '鏈煡閿欒'}`
- server.js:411 [杩] : '杩炴帴宸叉柇寮€';
- server.js:419 [杩] console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`);
- server.js:421 [杩] cam.error = '杩炴帴瓒呮椂锛岃妫€鏌?RTSP 鍦板潃鏄惁姝ｇ‘';
- server.js:450 [銆] // 鎺掗櫎铏氭嫙缃戝崱锛圴Mware銆丮ihomo VPN 绛夛級
- server.js:455 [娴] if (addr.startsWith('198.18.') \|\| addr.startsWith('198.19.')) continue; // 娴嬭瘯/VPN 缃戞

## 6. 后续修复建议

- 优先修复 P0：页面 `title` 或主标题乱码。
- 第二优先修复 P1：页面按钮、导航、状态提示、运行时日志文案乱码。
- P3 命中建议人工确认，避免误改正则、token 或测试辅助文本。
- 修复前建议保留本报告作为定位清单，并逐文件人工确认真实原文。
- 禁止用简单全局替换修复，应按文件编码来源和上下文逐段恢复。

P0/P1 优先定位：

- P0 html/desktop-capture.html:6 [璇] <title>妗岄潰鎹曡幏鎺ㄦ祦 - 鐪熻鐪艰皟璇曞伐鍏?/title>
- P1 html/desktop-capture.html:165 [鐩] <p>灏嗗睆骞曘€佺獥鍙ｆ垨娴忚鍣ㄦ爣绛鹃〉浣滀负璋冭瘯鎽勫儚澶存帹閫佸埌鐩戞帶绯荤粺</p>
- P1 html/desktop-capture.html:171 [€] <div>鐐瑰嚮寮€濮嬫崟鑾蜂互閫夋嫨灞忓箷婧?/div>
- P1 html/desktop-capture.html:174 [涓] <div class="rec-badge" id="rec-badge"><i class="fa fa-circle"></i> 鎺ㄦ祦涓?/div>
- P0 html/webrtc-client.html:10 [鎽] <title>AI 鎽勫儚澶存帹娴佺</title>
- P1 html/webrtc-client.html:282 [鎽] <span>AI 鎽勫儚澶存帹娴?/span>
- P1 html/webrtc-client.html:298 [鍚] <p>鎽勫儚澶存湭鍚姩</p>
- P1 html/webrtc-client.html:299 [涓] <p class="hint">鐐瑰嚮涓嬫柟鎸夐挳寮€濮嬫帹娴?/p>
- P1 html/webrtc-client.html:314 [帹] <i class="fa-solid fa-play"></i> 寮€濮嬫帹娴? </button>
- P1 src/server.js:68 [] console.log('[ffmpeg] 浣跨敤 npm 鎹嗙粦璺緞:', FFMPEG_PATH);
- P1 src/server.js:71 [涓] console.log('[ffmpeg] 浣跨敤绯荤粺 PATH 涓殑 ffmpeg');
- P1 src/server.js:181 [€] throw new Error('闇€瑕佹湁鏁堢殑 RTSP 鍦板潃');
- P1 src/server.js:254 [澶] console.warn('[camera-config] 淇濆瓨澶辫触:', err.message);
- P1 src/server.js:317 [€] console.log(`[RTSP:${id}] 宸叉柇寮€`);
- P1 src/server.js:334 [杩] console.log(`[RTSP:${id}] 姝ｅ湪杩炴帴: ${maskCameraUrl(url)}`);
- P1 src/server.js:386 [璇] console.error(`[RTSP:${id}] 甯ц浆鎹㈤敊璇?`, err.message);
- P1 src/server.js:400 [鍚] cam.error = `ffmpeg 鍚姩澶辫触: ${err.message}`;
- P1 src/server.js:406 [€] console.log(`[RTSP:${id}] 閫€鍑?code=${code} signal=${signal}`);
- P1 src/server.js:419 [杩] console.error(`[RTSP:${id}] 杩炴帴瓒呮椂锛?0绉掓棤甯э級`);
- P1 src/server.js:476 [璇] if (alertDetails?.length) line += `璀︽姤璇︽儏: ${alertDetails.join(', ')}\n`;

## 7. 本轮边界

- 本轮按用户要求排除 `docs/` 文件夹乱码情况。
- 本轮只读扫描和报告口径调整。
- 没有修改源码。
- 没有修复乱码。
- 没有启动项目。
- 没有修 nginx。
- 没有运行 `npm install`。
- 没有读取 `.env` 密钥。
