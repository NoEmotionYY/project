# CYPHER

CYPHER 是一个 Electron + Node/Express 的本地视觉监控项目，包含 WebRTC/RTSP 摄像头接入、SSE 推送、录像和技能插件能力。

## 当前启动链路

- Electron 主入口是 `electron-main.js`，`npm start` 会执行 `electron .`。
- Electron 主进程通过 `fork` 启动 `src/server.js`，并传入端口、证书、日志和 Python 路径等环境变量。
- 开发模式也可以执行 `npm run dev`，由 `dev.js` 启动 `src/server.js`、nginx，再打开新版 dashboard 主界面。
- Node/Express 后端负责 HTTPS API、WebRTC/RTSP、录像、SSE 和技能管理。
- 前端主页面是 `html/dashboard.html`，`/monitor` 仅作为兼容入口；录像页是 `html/recordings.html`。
- 技能系统扫描 `skills/`，只运行已明确启用的技能；安装技能不会自动启用。
- 录像必须通过 `/api/recordings/:id/start` 显式开始，收到视频帧不会自动开始录像。

## 环境变量

先复制示例文件，再填入真实值：

```bash
cp .env.example .env
```

Windows:

```bat
copy .env.example .env
```

Qwen/DashScope 密钥通过 `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` 提供，不能写入源码。

## 启动方式

```bash
npm install
npm run dev
```

或直接启动 Electron：

```bash
npm start
```

只启动后端：

```bash
npm run server
```

## 第一轮安全变化

- Web 技能安装接口已禁用，会返回 403。
- 技能安装路径会做 basename、扩展名白名单和固定目录归一化校验。
- 技能安装后保持 disabled，不会自动启用或加载执行。
- Qwen-VL 不再硬编码 API Key，改为读取环境变量。
- 录像路径固定在项目内 `RECORDINGS_DIR` 根目录下，摄像头 ID 和文件名会被白名单化并校验。
- `writeVideoFrame()` 不再因收到视频帧自动启动录像。
- 进程清理只清理当前应用启动并记录的子进程 PID，不再按进程名清杀全局 Node。

## 第二轮：Vigil 检测治理融合

- 本轮增强的是现有 `skills/yolo-safety.py`，不会新建 FastAPI 服务，也不会引入 Vigil 的登录、注册、pywebview 或窗口控制逻辑。
- YOLO 本地初筛优先：安全帽、反光衣、未戴安全帽、未穿反光衣、火灾、烟雾先由本地模型检测。
- 告警治理在技能内完成：按类别阈值、连续确认次数、冷却时间生成 alerts；普通 `helmet` / `vest` 只作为 detections 输出，不生成告警。
- Qwen/DashScope 只作为低频复核预留：只有 YOLO 已确认告警、配置允许、且存在 `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` 时，alert 才会标记 `needsReview`；不会每秒全量调用 Qwen。
- 模型路径可通过 `CYPHER_YOLO_MODEL`、`CYPHER_YOLO_PPE_MODEL`、`CYPHER_YOLO_FIRE_MODEL` 覆盖；默认优先项目内 `models/` 或 `skills/best.pt`，最后才 fallback 到 `yolov8n.pt` 开发模型。
- 启用方式仍通过现有技能系统完成：在技能列表中显式启用 `yolo-safety`，安装技能不会自动启用。

## 第三轮：事件库和快照治理

- 告警事件统一写入 `data/alerts.db` 的 `alerts` 表；旧表会自动补齐新增列。
- 告警快照统一保存到 `data/snapshots/YYYY/MM/DD/<cameraId>/`，返回和入库路径均为项目相对路径。
- 事件表预留 `camera_label`、`category`、`video_path`、`raw_json` 等字段，方便后续日志页、事件中心和录像片段接入。
- `data/`、`snapshots/`、日志和录像目录均被 `.gitignore` 忽略，不应提交运行态数据。

## Round4 API foundation

- `/api/events` 继续作为 SSE 实时流使用，不是事件列表接口。
- 事件列表使用 `GET /api/alerts`，支持 `page`、`limit`、`camera_id`、`category`、`severity`、`start`、`end`、`q`、`sort` 查询参数。
- 事件详情使用 `GET /api/alerts/:id`，详情会返回 `raw_json`，合法 JSON 会附带 `raw` 对象。
- 快照建议通过 `GET /api/alerts/:id/snapshot` 访问；后端会先查 `data/alerts.db`，再校验路径必须位于 `data/snapshots/` 内。
- 检测配置接口为 `GET /api/detection/config` 和 `POST /api/detection/config`。
- 检测配置保存到固定文件 `data/detection-config.json`，只允许阈值、连续确认帧数、冷却时间、模型 profile、Qwen 复核开关和分析间隔。
- 事件库位置固定为 `data/alerts.db`。
- 快照位置固定为 `data/snapshots/YYYY-MM-DD/<camera>_<alertType>_<HHMMSS>.jpg`，同秒重复时可追加毫秒/短后缀。
- 后续迁移 Vigil 页面时，不迁移 `/video_feed`、FastAPI、pywebview、登录注册或 Vigil 用户库。

## Round5 page migration

- 新增页面入口：`/events` 事件中心、`/settings` 检测配置、`/dashboard` 威胁感知。
- `logs/events` 已迁移到 `html/events.html`，使用 `GET /api/alerts`、`GET /api/alerts/:id`、`GET /api/alerts/:id/snapshot`。
- `settings` 已迁移到 `html/settings.html`，使用 `GET/POST /api/detection/config`，并只读展示 `/api/cameras` 与 `/api/skills`。
- `dashboard` 威胁感知能力已迁移到 `html/dashboard.html`，使用 `/api/events` SSE、`/api/analysis`、`/api/frame` 和 `/api/cameras/:id/frame`。
- Vigil 旧接口替换关系：`/video_feed` 改为 `/api/frame` 或 `/api/cameras/:id/frame`；`/logs` 改为 `/api/alerts`；`/camera_config` 改为 `/api/detection/config`；`/api/alerts/recent` 改为 `/api/events` SSE。
- 不迁移 Vigil `index.html` / `register.html`、FastAPI、pywebview、`vigil_logs.db`、`users.json`。

## Round6 E2E validation

- Round6 validates the migrated pages and API chain end to end through the real `src/server.js` backend.
- Page entries: `/monitor`, `/recordings`, `/events`, `/settings`, and `/dashboard`.
- Event center data uses `GET /api/alerts` and `GET /api/alerts/:id`.
- Snapshots must be accessed through `GET /api/alerts/:id/snapshot`; `data/` is not exposed as a static directory.
- `/api/events` is the SSE realtime stream, not the JSON event-list API.
- Detection settings use `GET /api/detection/config` and `POST /api/detection/config`.
- Vigil login/register, FastAPI, pywebview, `/video_feed`, `users.json`, and `vigil_logs.db` remain intentionally unmigrated.

## Round7 dashboard main UI

- 新版 `html/dashboard.html` 已设为项目主界面，标题为 `CYPHER 威胁感知中心`。
- `/dashboard` 是主页面；`/monitor` 不再显示旧 monitor UI，后端和 nginx 兼容入口均服务新版 dashboard，`html/monitor.html` 仅保留跳转页。
- 旧 `monitor.html` 已归档到 `legacy/html/monitor-old.html`。
- 旧 monitor 的 AI 分析能力已合入新版 dashboard，包含 `AI 分析` 面板、`analysis-content`、`analysis-time`、`analysis-status` 和 `updateAnalysisDisplay()`。
- 技能管理已改为 dashboard 顶部按钮打开的标签弹窗，包含“已启用 / 全部技能 / 安全说明”三个标签。
- 页面只允许通过 `GET /api/skills` 查看技能，并通过用户确认后的 `POST /api/skills/toggle` 显式启用/禁用；不支持 Web 上传或安装技能。
- dashboard 继续使用 `/api/events` SSE、`/api/analysis` fallback、`/api/frame`、`/api/cameras` 和 `/api/cameras/:id/frame`。
- 旧 Vigil 接口仍然禁用/未使用：不恢复 `/video_feed`、`/api/alerts/recent`、`/camera_config`、`/api/model/current`、`/api/model/switch`、FastAPI、pywebview、登录注册。

### Local nginx test certificate

`npm test` prepares local self-signed test certificates automatically:

```bash
npm run prepare-test-cert
```

The generated files are local/dev-only and ignored by Git:

- `nginx/conf/cert.pem`
- `nginx/conf/key.pem`
- `cert.pem`
- `key.pem`

### Test commands

```bash
npm test
node tests/test-round4-api-foundation.js
node tests/test-round5-page-migration.js
node tests/test-round6-e2e-validation.js
node tests/test-round7-dashboard-main-ui.js
python tests/test-yolo-safety-governance.py
```

For repeatable event-center test data:

```bash
python scripts/seed-test-alert.py
```

## Legacy Python

`legacy/backend.py` 是旧 Python 后端，不属于当前主启动链路。它已移除硬编码密钥，仅保留为 legacy 参考；如历史提交中曾包含真实密钥，需要到对应平台手动轮换。

## Round9 real camera, env, and packaging update

- Browser sender pages now resolve the native WebRTC constructor with `window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection` and show clear HTTPS/browser/permission guidance instead of failing with `RTCPeerConnection is not a constructor`.
- Dashboard live view uses `/api/frame` and `/api/cameras/:id/frame`; when a real WebRTC sender creates `webrtc-N`, the server now marks that camera active after `/offer` and after the first processed frame if the current active camera has no frame.
- Detection settings now include camera source management: add/edit/delete RTSP/IP/URL cameras, start/stop, set active, view status/frame count/error, and see `/api/cameras/:id/frame`.
- Camera configuration is stored in fixed runtime file `data/cameras.json`; RTSP credentials are masked in API responses and logs.
- Runtime configuration is centralized through `.env`; copy `.env.example` to `.env`. Node entries load `dotenv` in `src/server.js`, root `server.js`, `dev.js`, `electron-main.js`, and `skills/qwen-vl.js`.
- `DASHSCOPE_API_KEY` is the Aliyun DashScope API key used by Qwen/Qwen-VL calls. Qwen model selection is configured with `QWEN_MODEL` or `DASHSCOPE_MODEL`, defaulting to `qwen-vl-plus`.
- New packaging command: `npm run package-new` or `node scripts/package-new-project.js`. It creates a clean runtime copy at `D:\test\NEW-project`, excluding `.git/`, `node_modules/`, `bin/`, `data/`, `recordings/`, logs, generated certs, `.env`, and the old Vigil project.
- New project run flow:

```powershell
Set-Location 'D:\test\NEW-project'
npm install
copy .env.example .env
node scripts/ensure-test-cert.js
npm run dev
```

- Main UI: `https://127.0.0.1:8443/dashboard`; camera sender: `https://127.0.0.1:8443/`; settings: `https://127.0.0.1:8443/settings`.
