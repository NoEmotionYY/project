# CYPHER 椤圭洰瀹屾暣娴嬭瘯鎶ュ憡

## 1. 娴嬭瘯缁撹
- 鎬讳綋鐘舵€侊細閫氳繃銆?- 鏄惁鍙互杩涘叆涓嬩竴杞紭鍖栵細鍙互銆?- 鏄惁瀛樺湪闃诲闂锛氭棤闃诲娴嬭瘯澶辫触銆?- 渚濇嵁锛氭湰杞湡瀹炴墽琛岃娉曟鏌ャ€丳ython 缂栬瘧妫€鏌ャ€丷ound2/Round4/Round5/Round6 娴嬭瘯銆佹祴璇曡瘉涔﹀噯澶囥€乻eed alert銆乣npm test`銆侀〉闈?API 琛ュ厖鑱旇皟鍜屽畨鍏ㄥ洖褰掓壂鎻忥紱鏍稿績鍛戒护鍧囬€氳繃銆?- 鐜瑙傚療锛氬綋鍓?`8082` 绔彛宸叉湁鏈」鐩?`dev.js -> src/server.js` 杩涚▼鐩戝惉锛宍npm test` 鑷姩浣跨敤 `8083` 鍚姩娴嬭瘯鍚庣骞堕€氳繃锛涜杩涚▼涓嶆槸鏈疆娴嬭瘯鑴氭湰鍚姩锛屾湭寮哄埗缁堟銆?
## 2. 娴嬭瘯鐜
- 鎿嶄綔绯荤粺锛歁icrosoft Windows NT 10.0.26200.0銆?- PowerShell锛?.1.26100.8115銆?- Node锛歷20.10.0銆?- npm锛?0.5.0銆?- Python锛歅ython 3.11.7銆?- 褰撳墠鐩綍锛歚C:\Users\19423\xwechat_files\wxid_vbrhbcmlkeyk22_8296\msg\file\2026-05\CYPHER\CYPHER`銆?- nginx锛歚nginx/bin/nginx-win.exe` 瀛樺湪銆?- 娴嬭瘯璇佷功锛歚nginx/conf/cert.pem` 涓?`nginx/conf/key.pem` 瀛樺湪锛涚敱 `scripts/ensure-test-cert.js` 鍑嗗锛屼粎鐢ㄤ簬鏈湴娴嬭瘯銆?
## 3. 娴嬭瘯鑼冨洿
- 鍚庣 API锛氬凡娴嬨€?- 鍓嶇椤甸潰锛氬凡娴嬨€?- SSE锛氬凡娴嬶紝`/api/events` 浠嶄负 `text/event-stream`銆?- 浜嬩欢搴擄細宸叉祴锛宍data/alerts.db` 鍙啓鍏ュ拰鏌ヨ seed alert銆?- 蹇収锛氬凡娴嬶紝浜嬩欢 ID 蹇収鎺ュ彛鍙繑鍥炲浘鐗囷紝缂哄け杩斿洖 404锛岃矾寰勭┛瓒婅繑鍥?403銆?- detection config锛氬凡娴嬶紝鍚堟硶淇濆瓨鎴愬姛锛岄潪娉曞瓧娈佃鎷掔粷銆?- 鎶€鑳界郴缁燂細宸叉祴娌荤悊閫昏緫鍜屾妧鑳藉畨鍏ㄥ洖褰掋€?- 褰曞儚瀹夊叏锛氬凡娴?`/api/recordings` 杩斿洖鏄惧紡鐘舵€侊紝鏈嚜鍔ㄥ紑濮嬪綍鍍忋€?- 瀹夊叏鍥炲綊锛氬凡鎵€?- `npm test`锛氬凡閫氳繃銆?
## 4. 杩炵画鎬ф枃妗ｈ鍙栨儏鍐?- 宸茶鍙?`docs/CODEX_TASK_CONTEXT.md`銆?- 宸茶鍙?`docs/CODEX_SECURITY_ROUND1.md`銆?- 宸茶鍙?`docs/CODEX_VIGIL_ROUND2.md`銆?- 宸茶鍙?`docs/CODEX_EVENTS_ROUND3.md`銆?- 宸茶鍙?`docs/CODEX_ROUND4_PRE_MIGRATION_AUDIT.md`銆?- 宸茶鍙?`docs/CODEX_ROUND4_API_FOUNDATION.md`銆?- 宸茶鍙?`docs/CODEX_ROUND5_PAGE_MIGRATION.md`銆?- 宸茶鍙?`docs/CODEX_ROUND6_E2E_VALIDATION.md`銆?
## 5. 鍛戒护鎵ц缁撴灉琛?
| 绫诲埆 | 鍛戒护 | 缁撴灉 | 璇存槑 |
|---|---|---|---|
| 缁撴瀯 | `pwd` | 閫氳繃 | 褰撳墠鐩綍涓?CYPHER 椤圭洰鏍圭洰褰曘€?|
| 缁撴瀯 | `ls` | 閫氳繃 | `src`銆乣html`銆乣skills`銆乣tests`銆乣docs`銆乣nginx`銆乣scripts`銆乣data` 绛夌洰褰曞瓨鍦ㄣ€?|
| 缁撴瀯 | 鍏抽敭鏂囦欢 `Test-Path` 妫€鏌?| 閫氳繃 | 鎸囧畾鍏抽敭鏂囦欢鍏ㄩ儴瀛樺湪锛屾棤缂哄け銆?|
| 鐜 | `node -v` | 閫氳繃 | v20.10.0銆?|
| 鐜 | `npm -v` | 閫氳繃 | 10.5.0銆?|
| 鐜 | `python --version` | 閫氳繃 | Python 3.11.7銆?|
| 璇硶 | `node --check src/server.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check server.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check src/skill-manager.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check src/round4-api-foundation.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check electron-main.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check dev.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check skills/qwen-vl.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check tests/test-system.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check tests/test-round4-api-foundation.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check tests/test-round5-page-migration.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 璇硶 | `node --check tests/test-round6-e2e-validation.js` | 閫氳繃 | 鏃犺娉曢敊璇€?|
| 缂栬瘧 | `python -m py_compile skills/yolo-safety.py` | 閫氳繃 | Python 缂栬瘧閫氳繃銆?|
| 缂栬瘧 | `python -m py_compile legacy/backend.py` | 閫氳繃 | Python 缂栬瘧閫氳繃銆?|
| 缂栬瘧 | `python -m py_compile scripts/query-alerts.py` | 閫氳繃 | Python 缂栬瘧閫氳繃銆?|
| 缂栬瘧 | `python -m py_compile scripts/seed-test-alert.py` | 閫氳繃 | Python 缂栬瘧閫氳繃銆?|
| 鍗曟祴 | `python tests/test-yolo-safety-governance.py` | 閫氳繃 | 8 椤规不鐞嗘祴璇曞叏閮?`ok`銆?|
| 闆嗘垚 | `node tests/test-round4-api-foundation.js` | 閫氳繃 | 5 椤?Round4 API foundation 娴嬭瘯鍏ㄩ儴 `ok`銆?|
| 椤甸潰 | `node tests/test-round5-page-migration.js` | 閫氳繃 | 椤甸潰杩佺Щ闈欐€佹鏌ラ€氳繃銆?|
| 璇佷功 | `node scripts/ensure-test-cert.js` | 閫氳繃 | 杈撳嚭 `Local test certificate files already exist`銆?|
| 鏁版嵁 | `python scripts/seed-test-alert.py` | 閫氳繃 | 鍐欏叆 seed alert锛岃緭鍑?`success: true`锛屾湰娆¤繑鍥?id `9`銆?|
| E2E | `node tests/test-round6-e2e-validation.js` | 閫氳繃 | 杈撳嚭 `Round6 e2e validation checks passed`銆?|
| npm | `npm test` | 閫氳繃 | 14 passed, 0 failed锛汵ode 涓?nginx 椤甸潰/API 鍧囬€氳繃銆?|
| API 琛ユ祴 | 涓存椂鍚姩 `src/server.js` 璇锋眰 `GET /api/recordings` | 閫氳繃 | HTTP 200锛岃繑鍥?`isRecording:false` 鍜岀┖鏂囦欢鍒楄〃銆?|
| scripts | `node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2));"` | 閫氳繃 | `test` 璋冪敤 `ensure-test-cert` 鍜?`test-system`锛汻ound4/5/6 娴嬭瘯鏈疆鎵嬪姩鎵ц銆?|
| gitignore | `Select-String .gitignore ...` | 閫氳繃 | 宸?ignore 娴嬭瘯璇佷功銆乣data/`銆乣recordings/`銆乣snapshots/`銆乣logs/`銆?|

## 6. 椤甸潰娴嬭瘯缁撴灉

| 椤甸潰 | 璺緞 | 缁撴灉 | 璇存槑 |
|---|---|---|---|
| 鐩戞帶椤?| `/monitor` | 閫氳繃 | `npm test` 楠岃瘉 Node 涓?nginx 鍧囪繑鍥?200锛汻ound6 妫€鏌ョ‘璁ゆ棤鏃?Vigil 鎺ュ彛銆?|
| 褰曞儚椤?| `/recordings` | 閫氳繃 | Round6 椤甸潰璺敱妫€鏌ラ€氳繃锛涢潤鎬佹鏌ョ‘璁や笉鑷姩寮€濮嬪綍鍍忋€?|
| 浜嬩欢涓績 | `/events` | 閫氳繃 | Round6 鐪熷疄 server 楠岃瘉杩斿洖 200锛涗娇鐢?`/api/alerts` 鍜屼簨浠?ID 蹇収鎺ュ彛銆?|
| 璁剧疆椤?| `/settings` | 閫氳繃 | Round6 鐪熷疄 server 楠岃瘉杩斿洖 200锛涗娇鐢?`GET/POST /api/detection/config`銆?|
| 鐪嬫澘椤?| `/dashboard` | 閫氳繃 | Round6 鐪熷疄 server 楠岃瘉杩斿洖 200锛涗娇鐢?`/api/events` SSE銆乣/api/analysis`銆乣/api/frame` 鎴?`/api/cameras/:id/frame`銆?|

## 7. API 娴嬭瘯缁撴灉

| API | 缁撴灉 | 璇存槑 |
|---|---|---|
| `GET /api/info` | 閫氳繃 | `npm test` 楠岃瘉 Node 涓?nginx proxy 鍧囪繑鍥?200銆?|
| `GET /api/alerts` | 閫氳繃 | Round6 E2E 楠岃瘉鍙煡璇?seed alert锛屾敮鎸?`limit/category/severity`锛屽垪琛ㄤ笉灞曞紑 `raw_json`銆?|
| `GET /api/alerts/:id` | 閫氳繃 | Round6 E2E 楠岃瘉杩斿洖璇︽儏銆乣raw_json` 鍜岃В鏋愬悗鐨?`raw`銆?|
| `GET /api/alerts/:id/snapshot` | 閫氳繃 | Round6 E2E 楠岃瘉鍙繑鍥炲浘鐗囷紝缂哄け 404锛岃矾寰勭┛瓒?403銆?|
| `GET /api/detection/config` | 閫氳繃 | Round6 E2E 楠岃瘉杩斿洖 thresholds銆乧onfirmFrames銆乧ooldowns銆乵odelProfile銆乹wenReview銆乤nalysisIntervalMs銆?|
| `POST /api/detection/config` | 閫氳繃 | Round6 E2E 楠岃瘉鍚堟硶閰嶇疆鍙繚瀛橈紱闈炴硶 threshold/modelProfile/API key/path/鏈煡瀛楁琚嫆缁濄€?|
| `GET /api/events` | 閫氳繃 | Round6 E2E 楠岃瘉 Content-Type 涓?`text/event-stream`锛屽垵濮?payload 鍙В鏋愪笖鍚?`alerts` / `detections` 鏁扮粍銆?|
| `GET /api/analysis` | 閫氳繃 | Round6 E2E 楠岃瘉杩斿洖褰撳墠鑱氬悎鍒嗘瀽缁撴灉銆?|
| `GET /api/frame` | 閫氳繃 | Round6 E2E 楠岃瘉鏃犲抚鏃惰繑鍥炲悎鐞嗙姸鎬侊紱椤甸潰鏈娇鐢?`/video_feed`銆?|
| `GET /api/cameras` | 閫氳繃 | Round6 E2E 楠岃瘉杩斿洖鎽勫儚澶村垪琛ㄧ粨鏋勩€?|
| `GET /api/recordings` | 閫氳繃 | 鏈疆琛ユ祴鐪熷疄璇锋眰杩斿洖 200锛宍isRecording:false`锛岃鏄庢湭鑷姩褰曞儚銆?|

## 8. 瀹夊叏鍥炲綊缁撴灉

| 椤圭洰 | 缁撴灉 | 鍒嗙被 | 璇存槑 |
|---|---|---|---|
| 鍏ㄥ眬鏉€杩涚▼ | 閫氳繃 | 瀹夊叏 | `rg -n "taskkill.*\\/IM|pkill node|killall node|wmic.*server\\.js.*delete" .` 鏃犲懡涓€?|
| 纭紪鐮佸瘑閽?| 閫氳繃 | bin/Chromium license 璇姤 | 浠呭懡涓?`bin/.../LICENSES.chromium.html` 涓?`font-disk-loader-ios` URL锛屼笉鏄?API key銆?|
| 鑷姩褰曞儚 | 閫氳繃 | 瀹夊叏 | `writeVideoFrame()` 闄勮繎鏃犺嚜鍔?`startVideoRecording` 鍛戒腑銆?|
| 鎶€鑳借嚜鍔ㄥ惎鐢?| 閫氳繃 | 瀹夊叏 | 鏈懡涓?`enabledState[...] = true`銆乣宸插畨瑁呭苟鍚敤`銆乣鑷姩鍚敤`銆?|
| Web 鎶€鑳藉畨瑁?| 閫氳繃 | 瀹夊叏 | 鍛戒腑浠呬负 `src/server.js` 鍜?root `server.js` 鐨勬棭鏈?403 disabled route锛歚rejectWebSkillInstallation`銆?|
| 鏃?Vigil 鎺ュ彛鍥炴祦 | 閫氳繃 | 瀹夊叏 | `html`銆乣src`銆乺oot `server.js`銆乣tests` 鏈懡涓?FastAPI銆乸ywebview銆乣/video_feed`銆佹棫鐧诲綍/娉ㄥ唽/妯″瀷鍒囨崲鎺ュ彛绛夈€?|
| 蹇収璺緞绌胯秺 | 閫氳繃 | 瀹夊叏 | Round6 E2E 楠岃瘉 traversal snapshot path 杩斿洖 403銆?|
| 鐩存帴鏆撮湶 data 鐩綍 | 閫氳繃 | 瀹夊叏 | 鏈懡涓?`express.static(data)`銆乣app.use(data)` 鎴?`/api/snapshots` 鐩存帴闈欐€佹毚闇层€?|
| 椤甸潰鏃ф帴鍙ｆ畫鐣?| 閫氳繃 | 瀹夊叏 | `rg` 鎵弿 `html/` 鏈懡涓棫 Vigil 鎺ュ彛銆?|

## 9. 宸茬煡闂
- `video_path` 灏氭湭鍏宠仈褰曞儚鐗囨銆?- Qwen 鑷姩澶嶆牳闂幆鏈仛銆?- `performance_monitor.html` 鏆傛湭杩佺Щ锛屽洜涓鸿繕缂虹湡瀹?metrics API銆?- 濡傛灉鐪熷疄 API Key 鏇剧粡杩涘叆 Git 鍘嗗彶鎴栨瀯寤轰骇鐗╋紝闇€瑕佸幓瀵瑰簲骞冲彴杞崲锛屽崟闈犲綋鍓嶅伐浣滃尯鍒犻櫎涓嶅銆?- 娴嬭瘯 seed 鏁版嵁浣嶄簬 `data/`锛屽睘浜庤繍琛屾€佹祴璇曟暟鎹紝涓嶅簲褰撴垚鐪熷疄鐢熶骇鏁版嵁銆?- `package.json` 褰撳墠 `npm test` 鍙覆鑱?`ensure-test-cert` 鍜?`tests/test-system.js`锛汻ound4/Round5/Round6 娴嬭瘯宸插湪鏈疆鎵嬪姩鎵ц锛屼笅涓€杞彲浠ヨ€冭檻鏂板 `test:full` 姹囨€昏剼鏈€?- 褰撳墠 `8082` 绔彛宸叉湁鏈」鐩?`dev.js -> src/server.js` 鐩戝惉锛涙湰杞病鏈夊己鍒剁粓姝㈣闈炴祴璇曡剼鏈惎鍔ㄧ殑鏈嶅姟銆?
## 10. 涓嬩竴杞紭鍖栬鍒?
### P0
- 浜嬩欢鍒板綍鍍忕墖娈?`video_path` 鑷姩鍏宠仈銆?- 褰曞儚鐗囨鏌ヨ/鍥炴斁鑱斿姩浜嬩欢涓績銆?
### P1
- Qwen 澶嶆牳闂幆锛歚needsReview` -> `qwen-vl.js` -> 鏇存柊浜嬩欢 `reviewed_by_qwen/qwen_result`銆?- 椤甸潰灞曠ず澶嶆牳鐘舵€併€?
### P2
- 鐪熷疄 metrics API銆?- 杩佺Щ `performance_monitor.html`銆?- 杩愯鎬佹暟鎹竻鐞嗚剼鏈€?- 鏂板 `npm run test:full`锛岀粺涓€鎵ц Round4/Round5/Round6/Python 娌荤悊娴嬭瘯銆?
### P3
- 鐧诲綍/閴存潈璁捐锛屼粎鍦ㄦ槑纭渶瑕佹椂鍐嶅仛銆?- 鐢熶骇閮ㄧ讲閰嶇疆鏁寸悊銆?
## 11. 鏈€缁堝缓璁?- 寤鸿鎻愪氦褰撳墠鐗堟湰锛氬彲浠ャ€?- 寤鸿鎵?tag锛氬彲浠ワ紝寤鸿浣滀负 `round6-tested` 鎴栫瓑浠峰唴閮ㄩ獙鏀?tag銆?- 涓嬩竴杞缓璁粠 P0 寮€濮嬶細浼樺厛鍋氫簨浠朵笌褰曞儚鐗囨鐨?`video_path` 鍏宠仈锛岃浜嬩欢涓績鍏峰瀹屾暣杩芥函閾捐矾銆?
## 12. Round7 杩藉姞楠岃瘉璇存槑
- Round7 灏嗘柊鐗?`html/dashboard.html` 璁句负涓荤晫闈紝鏃?`monitor.html` 宸插綊妗ｅ埌 `legacy/html/monitor-old.html`锛宍/monitor` 浠呬綔涓哄吋瀹瑰叆鍙ｃ€?- 鏂板 `tests/test-round7-dashboard-main-ui.js`锛岀敤浜庢鏌?dashboard 鏂扮増鍩虹嚎銆丄I 鍒嗘瀽鏍忋€佹妧鑳界鐞嗗脊绐椼€佺姝㈡棫 Vigil 鎺ュ彛銆佺姝?Web 鎶€鑳藉畨瑁呭叆鍙ｅ拰 `/monitor` 鍏煎绛栫暐銆?- 鏈姤鍛婄殑 Round7 瀹屾暣鍛戒护缁撴灉浠?`docs/CODEX_ROUND7_DASHBOARD_MAIN_UI.md` 涓哄噯杩藉姞璁板綍銆?
## Round9 琛ュ厖娴嬭瘯缁撹

- `node tests/test-round9-camera-env-package-fix.js`锛氶€氳繃銆傝鐩?WebRTC 椤甸潰瀹夊叏鏋勯€犲櫒銆乨ashboard 甯ф帴鍙ｃ€乻ettings 鎽勫儚澶存簮 UI銆乣.env.example`銆乣.gitignore`銆乨otenv 鍏ュ彛銆佹墦鍖呮帓闄よ鍒欙紝浠ュ強娴嬭瘯 I420 甯ц繘鍏?`processFrame()` 鍚?`/api/frame` 杩斿洖 `image/jpeg`銆?- `npm test`锛氶€氳繃锛?6 passed, 0 failed銆?- `node scripts/package-new-project.js`锛氶€氳繃锛岀敓鎴?`D:\test\NEW-project`锛屽鍒?57 椤癸紝璺宠繃 13 椤硅繍琛屾€?鏁忔劅/鏃ч」鐩枃浠躲€?- 鏂扮洰褰曞熀纭€妫€鏌ラ€氳繃锛歚node --check src/server.js`銆乣node --check electron-main.js`銆乣python -m py_compile skills/yolo-safety.py`銆?- 瀹夊叏鍥炲綊锛氭棫 Vigil 鎺ュ彛鏈洖娴佸埌涓婚〉闈?涓诲悗绔紱Web 鎶€鑳藉畨瑁呬粛鍙綔涓?403 绂佺敤璺敱瀛樺湪锛涙湭鍙戠幇 `.env.example` 鎴栨簮鐮佺‖缂栫爜鐪熷疄 key锛涜嚜鍔ㄥ綍鍍忓拰鎶€鑳借嚜鍔ㄥ惎鐢ㄦ湭鍥炲綊銆?

