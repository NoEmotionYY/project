# CYPHER Codex Task Context

## Project
- Project name: CYPHER

## Current Startup Chain
- `package.json` main entry is `electron-main.js`.
- `npm start` runs `electron .`.
- `npm run dev` runs `dev.js`, which starts `src/server.js`, nginx, then opens the dashboard page.
- `npm run server` runs `node src/server.js`.
- Electron starts the Node/Express backend by forking `src/server.js`, then starts nginx.
- Main UI is `html/dashboard.html`; `/monitor` is a compatibility entry. Recordings UI is `html/recordings.html`.
- Skill files are scanned from `skills/`; only explicitly enabled skills are executed.
- Recordings now require explicit `/api/recordings/:id/start`; incoming frames do not start recording.
- `legacy/backend.py` is old Python backend code and is not part of the current main startup chain.

## Known High-Risk Issues
- Web skill installation routes existed in `src/server.js` and root `server.js`.
- Skill install functions in `src/skill-manager.js` used caller-controlled names/paths and auto-enabled/loaded installed skills.
- `skills/qwen-vl.js` and old `backend.py` contained a hardcoded DashScope key.
- Recording paths used camera IDs and file names without full fixed-root normalization.
- `writeVideoFrame()` automatically started recording when no recorder existed.
- `electron-main.js`, `dev.js`, and tests had process cleanup by process/image name.
- Build artifacts under `bin/` contained stale packaged copies of vulnerable source.
- `README.md` did not describe the real Electron + Node startup chain.

## Security Hardening Goal
- Round 1 only: do not add business features, redesign architecture, or change UI.
- Make minimal security and stability fixes for high-risk issues.

## Round 2 Status
- Date: 2026-05-06.
- Round 2 target: Vigil detection governance fusion.
- Status: implemented and validated at code/test level; `npm test` still fails on the existing nginx certificate test environment issue.
- Vigil app-shell logic was not migrated. No FastAPI service, pywebview shell, login/register flow, window-control logic, or UI redesign was added.
- Detection governance now lives in `skills/yolo-safety.py`, using the existing persistent Python skill process and stdin/stdout JSON-lines protocol.
- The server still follows the current chain: latest active camera frame -> `skillManager.analyzeAll()` -> aggregated result -> SSE/API result -> existing `html/monitor.html` rendering.
- The server now passes `cameraId`, `timestamp`, and Qwen-review config context into enabled skills without changing the main frame pipeline.
- `skill-manager.js` now preserves `alerts` and `detections` arrays from skill results while retaining the existing aggregate fields used by the current UI.
- YOLO remains the local first pass. Qwen is only a low-frequency review flag (`needsReview`) after confirmed YOLO alerts and never replaces local YOLO screening.

## Round 3 Status
- Date: 2026-05-06.
- Round 3 target: unified event database and snapshot directory governance.
- Status: implemented and validated at code/test level; Round 3.1 completed the user-specified event schema and snapshot filename补齐. `npm test` still fails on the existing nginx certificate test environment issue.
- Event database remains fixed at `data/alerts.db`.
- Confirmed alert snapshots now live under `data/snapshots/YYYY-MM-DD/<cameraId>_<alertType>_<HHMMSS>.jpg`; same-second duplicates can add milliseconds and a short numeric suffix.
- The unified `alerts` schema includes the user-required fields `category_cn`, `model_name`, and `skill_id`.
- Compatibility/extension fields `created_at_ms`, `alert_type`, `title`, `message`, `source_skill`, `reviewed_by_qwen`, and `qwen_result` are retained.
- Existing older `alerts` tables are migrated in place with missing columns and indexes.
- Round 3.1 only changes new writes and schema migration; old snapshot files are not migrated.
- No UI page, FastAPI service, pywebview shell, or Qwen automatic review loop was added.

## Round 4 API Foundation Status
- Date: 2026-05-06.
- Round 4 target: backend API foundation for later Vigil dashboard/settings/logs migration.
- Status: implemented and validated at code/unit level; `npm test` still fails on the existing nginx certificate test environment issue.
- No page migration, UI layout change, FastAPI service, pywebview shell, `/video_feed`, login/register flow, or Vigil user DB migration was added.
- `/api/events` remains the SSE realtime stream.
- JSON event-list/detail APIs now use `/api/alerts` and `/api/alerts/:id`.
- Safe snapshot access now uses `/api/alerts/:id/snapshot`, resolving DB `snapshot_path` inside `data/snapshots/`.
- Detection config APIs now exist at `GET /api/detection/config` and `POST /api/detection/config`.
- Detection config is stored at fixed `data/detection-config.json` and only accepts whitelisted fields: thresholds, confirmFrames, cooldowns, modelProfile, qwenReview, and analysisIntervalMs.
- `src/server.js` and root `server.js` pass merged detection config into `skillManager.analyzeAll()` as `config` / `detectionConfig`.
- `skills/yolo-safety.py` accepts the server-facing `confirmFrames` alias while keeping `confirmCounts` compatibility.

## Round 5 Page Migration Status
- Date: 2026-05-06.
- Round 5 target: migrate usable Vigil page capabilities into CYPHER frontend while keeping the main chain unchanged.
- Status: implemented at page/static-route level; final validation results are recorded in `docs/CODEX_ROUND5_PAGE_MIGRATION.md`.
- Added `html/events.html` for event center/logs, using `/api/alerts`, `/api/alerts/:id`, and `/api/alerts/:id/snapshot`.
- Added `html/settings.html` for detection configuration, using `GET/POST /api/detection/config` and read-only `/api/cameras` / `/api/skills`.
- Added `html/dashboard.html` for threat awareness, using `/api/events` SSE, `/api/analysis`, `/api/frame`, and `/api/cameras/:id/frame`.
- Added `/events`, `/settings`, and `/dashboard` static page routes in both `src/server.js` and root `server.js`.
- `html/monitor.html` now links to the new pages and no longer triggers Web skill installation.
- `html/recordings.html` no longer auto-starts recordings when the recording page loads.
- Vigil login/register, FastAPI, pywebview, `/video_feed`, `users.json`, and `vigil_logs.db` remain intentionally unmigrated.

## Round 6 E2E Validation Status
- Date: 2026-05-07.
- Round 6 target: end-to-end validation and acceptance fixes after Round5 page migration.
- Status: completed and validated.
- Pages verified through the real Node backend: `/monitor`, `/recordings`, `/events`, `/settings`, and `/dashboard`.
- `npm test` now passes after adding local test-certificate preparation and fixing nginx static aliases for the migrated pages.
- Local test certificates are generated or copied by `scripts/ensure-test-cert.js`; generated cert/key files remain ignored and are not production credentials.
- A repeatable test-alert seed script exists at `scripts/seed-test-alert.py`; it writes a controlled alert to fixed `data/alerts.db` and creates a snapshot under `data/snapshots/YYYY-MM-DD/`.
- Round6 validation starts `src/server.js`, checks alerts list/detail/snapshot APIs, detection config GET/POST, `/api/events` SSE, `/api/analysis`, `/api/frame`, `/api/cameras`, and migrated pages.
- `tests/test-system.js` now checks current safe backend URL semantics instead of the obsolete `BACKEND_URL = ''` assertion.
- nginx test config now serves fixed page aliases for `/events`, `/settings`, and `/dashboard`; `/api/events` remains SSE.
- First-round safety constraints remained intact: no Web skill install, no install-time auto-enable, no incoming-frame auto recording, no hardcoded Qwen key, and no global process-name cleanup.

## Round 7 Dashboard Main UI Status
- Date: 2026-05-07.
- Round 7 target: use the user-provided new dashboard as the unified main UI.
- Status: implemented and validating.
- `html/dashboard.html` was already the new `CYPHER 威胁感知中心` baseline; it was incrementally enhanced instead of being replaced from Vigil.
- Old `html/monitor.html` was moved to `legacy/html/monitor-old.html`; the active `html/monitor.html` is now a minimal `/dashboard` compatibility redirect page.
- `/dashboard` is the main page. `/monitor` is a compatibility entry and no longer shows the old monitor UI.
- AI analysis display from old monitor was merged into dashboard as an `AI 分析` panel updated by `/api/events` SSE and `/api/analysis` fallback.
- Skill management was moved to a dashboard modal with tabs: enabled, all skills, and safety notes. It reads `/api/skills` and only toggles skills through explicit user confirmation with `/api/skills/toggle`.
- Web skill upload/install remains unavailable; the dashboard contains no file input or `/api/skills/install` call.
- Electron and `dev.js` now default to dashboard.

## Completed Changes
- Created and updated Codex continuity docs.
- Disabled HTTP/Web skill install routes with 403 JSON responses before request-body parsing.
- Hardened recording root/path handling with sanitized names and `path.resolve` containment checks.
- Removed automatic recording start from `writeVideoFrame()`.
- Hardened skill install destination handling and prevented install-time auto-enable/load.
- Removed hardcoded Qwen/DashScope key from active JS skill and legacy Python backend.
- Moved `backend.py` to `legacy/backend.py`.
- Replaced process-name cleanup with tracked child/PID cleanup.
- Added `.gitignore`, `.env.example`, and `requirements.txt`.
- Updated `README.md` and stale `说明.md` key/startup notes.
- Synced patched files into tracked packaged artifacts under `bin/` and repacked tracked `app.asar` files.
- Round 2: rewrote `skills/yolo-safety.py` into a pure Python detection-governance skill with lazy YOLO model loading/cache, centralized thresholds, consecutive-frame confirmation, cooldowns, safe snapshots, SQLite alert events, and Qwen review flags.
- Round 2: updated `src/skill-manager.js` to pass optional analysis context to skills and aggregate `alerts` / `detections`.
- Round 2: updated `src/server.js` and root `server.js` to pass active camera context and expose `alerts` / `detections` in the existing SSE payload.
- Round 2: updated `.env.example`, `.gitignore`, `README.md`, packaged source copies, and `app.asar` artifacts.
- Round 2: added zero-dependency Python governance tests at `tests/test-yolo-safety-governance.py`.
- Round 3: standardized alert DB schema and snapshot directory under `data/`.
- Round 3: added SQLite migration coverage for older alert tables.
- Round 3: passed `cameraLabel` from `src/server.js` / root `server.js` into skill analysis context.
- Round 3: synced updated event/snapshot code into tracked packaged artifacts under `bin/`.
- Round 3.1: added `category_cn`, `model_name`, and `skill_id` to new and migrated alert tables.
- Round 3.1: changed new snapshot writes to `data/snapshots/YYYY-MM-DD/<camera>_<alertType>_<time>.jpg`.
- Round 3.1: updated governance tests and packaged skill copies for the schema/snapshot补齐.

- Round 4: added `src/round4-api-foundation.js` for detection config validation, snapshot containment, and shared API helpers.
- Round 4: added `scripts/query-alerts.py`, a fixed-path, read-only SQLite helper using Python stdlib `sqlite3`.
- Round 4: added backend APIs `GET/POST /api/detection/config`, `GET /api/alerts`, `GET /api/alerts/:id`, and `GET /api/alerts/:id/snapshot` to both `src/server.js` and root `server.js`.
- Round 4: added `tests/test-round4-api-foundation.js`.
- Round 4: updated `skills/yolo-safety.py` config ingestion and `tests/test-yolo-safety-governance.py`.
- Round 4: added `scripts/**/*` to packaged files so the SQLite query helper is included in packaged builds.
- Round 5: added `html/events.html`, `html/settings.html`, and `html/dashboard.html`.
- Round 5: added `/events`, `/settings`, and `/dashboard` routes to both server entry files.
- Round 5: removed page-triggered Web skill installation behavior from `html/monitor.html`.
- Round 5: removed recording-page automatic recording start from `html/recordings.html`.
- Round 5: added `tests/test-round5-page-migration.js`.
- Round 6: added `scripts/ensure-test-cert.js` and wired it into `npm test`.
- Round 6: added `scripts/seed-test-alert.py` for controlled event/snapshot test data.
- Round 6: added `tests/test-round6-e2e-validation.js`.
- Round 6: fixed nginx static aliases for migrated pages and updated `electron-main.js` generated nginx config aliases.
- Round 6: updated `tests/test-system.js` to validate current page/API semantics and nginx migrated-page routing.
- Round 7: moved old monitor UI to `legacy/html/monitor-old.html`.
- Round 7: made `html/dashboard.html` the main page, with AI analysis panel and skill-management modal.
- Round 7: changed `/monitor` routes/aliases to serve dashboard as compatibility.
- Round 7: updated Electron/dev startup targets to `/dashboard`.
- Round 7: added `tests/test-round7-dashboard-main-ui.js` and updated Round5/Round6/system tests for dashboard main UI.

## True-File Final Verification
- Date: 2026-05-06.
- This pass verified real repository files instead of relying on prior markdown/diff output.
- Confirmed main startup chain remains Electron + `src/server.js` + nginx; `legacy/backend.py` is legacy only.
- Found one real residual issue: `/api/skills/install` and `/api/skills/install-path` were disabled, but the disabled routes were registered after `express.json()`, so HTTP bodies could be parsed before the 403.
- Fixed that residual by registering the 403 routes immediately after `const app = express();` in both `src/server.js` and root `server.js`; synced the packaged unpacked `src/server.js` copy and repacked the tracked `bin/ai-monitor-electron/resources/app.asar`.
- Confirmed recordings still require explicit `/api/recordings/:id/start`; `writeVideoFrame()` returns `false` without an active recorder.
- Confirmed skill installation cannot be triggered through Web HTTP routes and install functions do not auto-enable or load new skills.
- Confirmed Qwen/DashScope keys are read from environment variables only in active and legacy files.

## Unfinished Changes
- `npm test` certificate and migrated-page nginx route failures were resolved in Round6.
- Any platform key that was previously committed or distributed must be rotated manually.
- Round 2 did not implement cross-skill Qwen execution. Alerts can mark `needsReview: true`; a later round can wire that to `skills/qwen-vl.js` through the existing skill manager.
- Vigil source files were not present in this repository, so migration used the requested Vigil strategy patterns rather than copying code from a local Vigil tree.
- Round 3 did not add event-center/log pages or event query APIs; the normalized storage layer is ready for a later page/API round.
- Round 4 still did not migrate pages; next page migration can start from logs/events because alert list/detail/snapshot APIs now exist.
- Round 5 did not migrate `performance_monitor.html`; a real metrics API is needed first.
- Round 5 did not add login/register/auth; that requires a separate design if ever needed.

## Files Next Codex Must Read First
- `docs/CODEX_TASK_CONTEXT.md`
- `docs/CODEX_SECURITY_ROUND1.md`
- `package.json`
- `src/server.js`
- `src/skill-manager.js`
- `skills/yolo-safety.py`
- `skills/qwen-vl.js`
- `legacy/backend.py`
- `electron-main.js`
- `dev.js`
- `tests/test-system.js`
- `README.md`
- `docs/CODEX_VIGIL_ROUND2.md`
- `docs/CODEX_EVENTS_ROUND3.md`
- `docs/CODEX_ROUND4_PRE_MIGRATION_AUDIT.md`
- `docs/CODEX_ROUND4_API_FOUNDATION.md`
- `tests/test-yolo-safety-governance.py`
- `tests/test-round4-api-foundation.js`
- `tests/test-round5-page-migration.js`
- `docs/CODEX_ROUND5_PAGE_MIGRATION.md`
- `docs/CODEX_ROUND6_E2E_VALIDATION.md`
- `docs/CODEX_ROUND7_DASHBOARD_MAIN_UI.md`
- `tests/test-round6-e2e-validation.js`
- `tests/test-round7-dashboard-main-ui.js`
- `scripts/ensure-test-cert.js`
- `scripts/seed-test-alert.py`
- `src/round4-api-foundation.js`
- `scripts/query-alerts.py`

## Forbidden
- No UI polish.
- No new business features.
- No large refactors or architecture changes.
- No real secrets in files.
- No web-triggered skill installation.
- No automatic skill enable after install.
- No path construction directly from user input.
- No recording paths outside the fixed recordings root.
- No automatic recording from incoming frames.
- No global process-name cleanup commands.
- No deleting user data directories.

## Round9 状态：真实摄像头链路、.env 和精简打包完成

- 已修复浏览器推流页直接 `new RTCPeerConnection(...)` 导致的构造器错误，改为安全解析原生 PeerConnection 并提示 HTTPS/浏览器/权限要求。
- 已修复 WebRTC 动态摄像头 `webrtc-N` 与 dashboard active camera 不一致导致 `/api/frame` 无帧的问题。
- `html/settings.html` 已新增 RTSP/IP/URL 摄像头源管理，使用 `/api/cameras` 系列 API。
- 新增 `src/camera-config-store.js`，固定保存运行态摄像头配置到 `data/cameras.json`，并遮蔽 RTSP 密码。
- Node 入口统一加载 `.env`，`.env.example` 已补齐端口、Qwen/DashScope、YOLO、FFmpeg、默认摄像头配置。
- 新增 `scripts/package-new-project.js`，已生成精简副本 `D:\test\NEW-project`。
- 新增 `tests/test-round9-camera-env-package-fix.js`，验证 WebRTC 页面安全构造、dashboard 帧接口、settings 摄像头 API、dotenv、打包排除规则和测试帧进入 `/api/frame`。
- 本轮验证：`npm test` 通过，Round4/Round5/Round6/Round9 测试通过，安全回归扫描无主链路风险。
- 下次接手必须先读：`docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`、`docs/CODEX_RUNBOOK_CN.md`、`README.md`、`src/server.js`、`html/dashboard.html`、`html/settings.html`。
 
## Round10 NEW-project 基线审计状态

- 审计日期：2026-05-08 15:43:03 +08:00。
- 当前目录：`D:\test\NEW-project`。
- 已按要求先读取连续性文档和项目说明；精简副本中实际存在并读取了 `docs/CODEX_TASK_CONTEXT.md`、`docs/CODEX_RUNBOOK_CN.md`、`docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`、`docs/CODEX_FULL_TEST_REPORT.md`、`README.md`、`RUN_NEW_PROJECT.md`、`MANIFEST.md`、`.env.example`、`package.json`。
- 精简副本缺失可选单轮连续性文档：`CODEX_SECURITY_ROUND1.md`、`CODEX_VIGIL_ROUND2.md`、`CODEX_EVENTS_ROUND3.md`、`CODEX_ROUND4_API_FOUNDATION.md`、`CODEX_ROUND5_PAGE_MIGRATION.md`、`CODEX_ROUND6_E2E_VALIDATION.md`、`CODEX_ROUND7_DASHBOARD_MAIN_UI.md`、`CODEX_RUNTIME_STATUS.md`。
- 本轮没有执行 `npm install`：`node_modules/` 已存在，`npm ls --depth=0` 通过。
- 本轮没有生成 `.env`：`.env` 已存在，敏感 key 扫描未发现真实 `sk-` key。
- 本轮没有新生成测试证书：`node scripts/ensure-test-cert.js` 确认 `nginx/conf/cert.pem` 和 `nginx/conf/key.pem` 已存在。
- 能否启动：Node 后端可用，NEW-project 直连 `https://127.0.0.1:8083` 的页面/API 可访问；但 NEW-project 自己的 nginx 配置测试失败，因为 `nginx/logs` 目录缺失，`nginx/logs/error.log` 和 `nginx/logs/nginx.pid` 无法创建。
- 当前 `https://127.0.0.1:8443` 可访问，但 PID/命令行显示它由旧源目录 nginx 提供，不是 `D:\test\NEW-project` 的 nginx；因此不能把 8443 健康状态单独作为精简副本完整跑通证据。
- 访问 URL 状态：NEW-project 直连 `https://127.0.0.1:8083/`、`/dashboard`、`/monitor`、`/settings`、`/events`、`/recordings` 均返回 200；`/api/events` 为 `text/event-stream`；`/api/frame` 无帧返回 404 属可接受状态。
- 测试摘要：`python tests/test-yolo-safety-governance.py`、Round4、Round5、Round6、Round9 测试均通过；`npm test` 显示 16 passed / 0 failed，但 nginx 部分可能被已有旧 nginx 进程污染；`tests/test-round7-dashboard-main-ui.js` 缺失。
- 安全扫描摘要：未发现全局杀 node/nginx/electron 的运行代码；未发现硬编码真实 API key；未发现 incoming frame 自动录像回归；未发现源码自动启用技能回归；Web 技能安装路由仍为 403；旧 Vigil 接口仅命中文档说明；未发现 `data/` 静态暴露。
- 运行态注意：`skills/skills-state.json` 当前存在且启用了 `qwen-vl`，不是 MANIFEST 复制项；`.gitignore` 未显式忽略该运行态状态文件。
- 本轮没有改业务代码，没有修 bug，没有新增功能。
- 新增审计文档：`docs/CODEX_NEW_PROJECT_BASELINE_AUDIT.md`。
- 下一轮建议：优先处理 NEW-project nginx 运行态目录初始化和测试端口污染；补齐或明确移除 Round7 dashboard 测试；确认 `skills/skills-state.json` 运行态治理；之后再做现场 RTSP 摄像头真实拉流验收、事件 `video_path` 录像片段关联或 Qwen 自动复核闭环。
- 下次 Codex 必须先读：`docs/CODEX_TASK_CONTEXT.md`、`docs/CODEX_NEW_PROJECT_BASELINE_AUDIT.md`、`docs/CODEX_RUNBOOK_CN.md`、`docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`、`docs/CODEX_FULL_TEST_REPORT.md`、`README.md`、`RUN_NEW_PROJECT.md`、`MANIFEST.md`、`.env.example`、`package.json`。

## Round10 follow-up：8444 nginx 拒绝访问修复

- 日期：2026-05-08。
- 用户现象：打开 `https://127.0.0.1:8444/dashboard` 提示拒绝访问。
- 根因：`npm run dev` 选中备用 nginx 端口 8444 后，NEW-project 的 `nginx/logs` 目录不存在，导致 nginx 无法创建 `logs/error.log` 和 `logs/nginx.pid`，进程退出。
- 已修复：`dev.js` 新增 nginx 运行态目录初始化，启动前自动创建 `nginx/logs`、`nginx/temp` 和各 temp 子目录。
- 已修复：`tests/test-system.js` 启动测试 nginx 前也创建相同运行态目录。
- 已修复：`dev.js` 生成 `nginx-temp.conf` 时按实际 Node 端口重写 `/api/events`、`/api/`、`/offer` 代理目标，避免备用端口场景代理到旧的 8082。
- 当前验证：`node --check dev.js`、`node --check tests/test-system.js`、`nginx -t`、`npm test` 通过。
- 当前运行：已启动 NEW-project nginx 到 `8444`，PID `37920`，命令行指向 `D:\test\NEW-project\nginx\conf\nginx-temp.conf`；`https://127.0.0.1:8444/dashboard` 返回 200，`/api/info` 显示后端端口为 `8083`。

## Round12-lite 中文乱码只读扫描状态

- 日期：2026-05-09。
- 当前目录：`D:\test\NEW-project`。
- 已读取连续性文档和项目说明：`docs/CODEX_TASK_CONTEXT.md`、`docs/CODEX_NEW_PROJECT_BASELINE_AUDIT.md`、`docs/CODEX_RUNBOOK_CN.md`、`docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`、`docs/CODEX_FULL_TEST_REPORT.md`、`README.md`、`RUN_NEW_PROJECT.md`、`MANIFEST.md`、`.env.example`、`package.json`。
- 可选文档状态：`docs/CODEX_ROUND11_NEW_PROJECT_RUNTIME_FIX.md` 不存在；`docs/CODEX_RUNTIME_STATUS.md` 不存在。
- 本轮只读扫描范围：`html/`、`src/`、`skills/`、`scripts/`、`tests/`、`docs/`、README、RUN_NEW_PROJECT、MANIFEST、`.env.example`、`package.json`、`server.js`、`dev.js`、`electron-main.js`；排除 `node_modules/`、`.git/`、`bin/`、`data/`、`logs/`、`recordings/`、证书、`.env`、二进制和 `package-lock.json`。
- 轻量检查：`node --check scripts/ensure-test-cert.js`、`node --check src/server.js`、`node --check server.js` 均通过。
- 是否发现乱码：是。
- 乱码命中总数：246 条；严重程度统计为 P0 2 条、P1 40 条、P2 83 条、P3 121 条。
- 乱码主要集中：`docs/CODEX_FULL_TEST_REPORT.md`、`src/server.js`、`server.js`、`html/desktop-capture.html`、`html/webrtc-client.html`。
- 页面 title 检查：`html/webrtc-client.html` 的 title 为 `AI 鎽勫儚澶存帹娴佺`，判定乱码；其他指定页面 title 未按本轮规则判定为乱码，`html/desktop-capture.html` 未找到 title。
- 报告路径：`docs/CODEX_ROUND12_MOJIBAKE_SCAN.md`。
- 本轮没有修复乱码，没有修改源码、页面、测试、配置或 README；没有启动项目；没有修 nginx；没有读取 `.env` 密钥。
- 下一轮如需修复，必须先读取 `docs/CODEX_ROUND12_MOJIBAKE_SCAN.md`，按 P0/P1 优先级人工确认原文后再修。

## Round12-lite 口径调整：排除 docs 乱码

- 日期：2026-05-09。
- 用户要求：排除 `docs/` 文件夹里的乱码情况。
- 已更新报告：`docs/CODEX_ROUND12_MOJIBAKE_SCAN.md`。
- 新统计口径：扫描 `html/`、`src/`、`skills/`、`scripts/`、`tests/`、README、RUN_NEW_PROJECT、MANIFEST、`.env.example`、`package.json`、`server.js`、`dev.js`、`electron-main.js`；排除 `docs/`。
- 调整后命中总数：163 条；严重程度统计为 P0 2 条、P1 40 条、P2 0 条、P3 121 条。
- 乱码主要集中：`server.js` 74 条、`src/server.js` 74 条、`html/desktop-capture.html` 9 条、`html/webrtc-client.html` 6 条。
- 本次只调整扫描报告口径，没有修复乱码，没有修改源码、页面、测试、配置或 README。
