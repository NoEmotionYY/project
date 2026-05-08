# CYPHER 中文运行手册

## 1. 项目当前状态

CYPHER 已完成 Round1 到 Round7：

- Round1：高危安全修复已完成，Web 技能安装禁用，技能安装不自动启用，录像不再因视频帧自动开始。
- Round2：Vigil YOLO 检测治理策略已融合到 `skills/yolo-safety.py`。
- Round3 / Round3.1：事件库与快照目录已统一，事件写入 `data/alerts.db`，快照写入 `data/snapshots/YYYY-MM-DD/`。
- Round4：页面迁移所需 API 地基已补齐。
- Round5：`events`、`settings`、`dashboard` 页面已迁移到 CYPHER API。
- Round6：端到端验证完成，完整测试报告见 `docs/CODEX_FULL_TEST_REPORT.md`。
- Round7：新版 `dashboard.html` 已统一为主界面，旧 `monitor.html` 停用为兼容入口。

当前主链路是 Electron / `dev.js` 启动 `src/server.js` 和 nginx，再由 nginx 提供 HTTPS dashboard 主页面访问。

## 2. 项目运行逻辑总览

```text
Electron / dev.js
  ↓
src/server.js
  ↓
nginx
  ↓
html 页面
  ↓
摄像头帧 /api/frame
  ↓
skill-manager
  ↓
skills/yolo-safety.py / skills/qwen-vl.js
  ↓
alerts / detections
  ↓
data/alerts.db + data/snapshots
  ↓
/api/events SSE + /api/alerts JSON
  ↓
dashboard / events / settings 页面
```

`/api/events` 是 SSE 实时流，不是事件列表；事件列表使用 `/api/alerts`。当前主页面是 `/dashboard`，`/monitor` 仅用于兼容并指向新版 dashboard。

## 3. 启动链路说明

- `npm start`：启动 Electron 主进程，入口是 `electron-main.js`。
- `npm run dev`：运行 `node dev.js`，会启动 Node 后端和项目内 nginx，并默认打开 `/dashboard`。
- `npm run server`：只运行 `node src/server.js`，适合只调后端 API，不包含完整 nginx 链路。
- `src/server.js`：主后端实现。
- `server.js`：兼容入口，关键路由需要与主后端保持同步。
- nginx：使用 `nginx/conf/nginx-temp.conf` 运行态配置代理到 Node 后端，并提供 HTTPS 访问。

## 4. 环境要求

- Node.js：当前验证版本为 `v20.10.0`。
- npm：当前验证版本为 `10.5.0`。
- Python：当前验证版本为 `Python 3.11.7`。
- nginx：项目内置 `nginx/bin/nginx-win.exe`，本机 PATH 不要求安装 nginx。
- ffmpeg：录像能力依赖 ffmpeg，可按项目实际部署环境安装。
- Python 依赖：见 `requirements.txt`，YOLO 相关组件主要服务于 `skills/yolo-safety.py`。
- YOLO 模型：可通过 `.env` 中的 `CYPHER_YOLO_MODEL`、`CYPHER_YOLO_PPE_MODEL`、`CYPHER_YOLO_FIRE_MODEL` 配置。
- Qwen / DashScope Key：可选，只能通过环境变量 `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` 提供。

## 5. 第一次运行准备

```powershell
npm install
copy .env.example .env
node scripts/ensure-test-cert.js
```

如需 Python 技能：

```powershell
pip install -r requirements.txt
```

注意：

- 不要把真实 API Key 写进代码。
- 不要提交生成的 `nginx/conf/cert.pem` 和 `nginx/conf/key.pem`。
- 不要把 `data/`、`recordings/`、`logs/` 作为源码提交。

## 6. 推荐启动方式

```powershell
npm run dev
```

该命令会启动：

- Node 后端：`src/server.js`
- nginx 代理：项目内置 nginx
- 默认页面：新版 dashboard 主界面

本轮实际运行时，使用了等价的 `node dev.js` 独立进程方式启动，便于在当前会话继续写文档，同时保持服务运行。

## 7. 只启动后端方式

```powershell
npm run server
```

适用于只调试 Node API 的场景。该方式不代表完整 Electron + nginx 链路。

## 8. 页面访问地址

本轮实际健康实例：

- nginx 本机入口：`https://127.0.0.1:8443`
- Node 直连入口：`https://127.0.0.1:8082`
- 局域网 nginx 入口：`https://192.168.110.51:8443`

页面：

- 主界面：`https://127.0.0.1:8443/dashboard`
- 兼容入口：`https://127.0.0.1:8443/monitor`
- 录像管理：`https://127.0.0.1:8443/recordings`
- 事件中心：`https://127.0.0.1:8443/events`
- 检测配置：`https://127.0.0.1:8443/settings`

说明：Round7 当前健康 nginx 使用 `8443`，主页面是 `/dashboard`。

## 9. API 说明

- `GET /api/info`：后端信息和访问地址。
- `GET /api/frame`：当前活跃摄像头帧；无帧时返回合理错误状态。
- `GET /api/cameras`：摄像头列表。
- `GET /api/analysis`：当前聚合分析结果。
- `GET /api/events`：SSE 实时流，`Content-Type` 必须是 `text/event-stream`。
- `GET /api/alerts`：事件列表 JSON。
- `GET /api/alerts/:id`：事件详情。
- `GET /api/alerts/:id/snapshot`：按事件 ID 安全访问快照。
- `GET /api/detection/config`：读取检测配置。
- `POST /api/detection/config`：保存检测配置。
- `GET /api/recordings`：录像列表和状态。

## 10. 检测技能运行逻辑

- `src/skill-manager.js` 扫描 `skills/`。
- 技能只有显式启用后才会参与分析。
- Python 技能通过持久子进程和 stdin/stdout JSON 行协议通信。
- `skills/yolo-safety.py` 负责本地 YOLO 初筛、连续帧确认、冷却治理、快照保存和事件写入。
- `skills/qwen-vl.js` 只通过环境变量读取 Qwen / DashScope Key。
- Qwen 自动复核闭环尚未作为主流程打通，后续可基于 `needsReview` 字段扩展。
- Python 技能不直接操作前端，所有页面通过 Node API 和 SSE 获取结果。

## 11. 事件库和快照

- 事件库：`data/alerts.db`
- 表：`alerts`
- 快照目录：`data/snapshots/YYYY-MM-DD/<cameraId>_<alertType>_<HHMMSS>.jpg`
- 页面访问快照必须走：`/api/alerts/:id/snapshot`
- 项目不会直接暴露整个 `data/` 静态目录。

## 12. 录像逻辑

- 录像必须显式调用 `/api/recordings/:id/start` 后才开始。
- incoming frame 不会自动触发录像。
- `GET /api/recordings` 用于查看录像列表和当前状态。
- `video_path` 目前是事件库预留字段，尚未自动关联录像片段。

## 13. 页面操作说明

- `dashboard`：主界面和威胁感知看板，通过 SSE 接收实时告警，并用 `/api/frame` 或摄像头帧接口刷新画面；同时包含 AI 分析面板和技能管理弹窗。
- `monitor`：兼容入口，不再显示旧 monitor UI。
- `events`：事件中心，通过 `/api/alerts` 查询事件，通过 `/api/alerts/:id/snapshot` 查看快照。
- `settings`：检测配置页，通过 `/api/detection/config` 读取和保存阈值、连续确认帧、冷却时间、模型 profile 等配置。
- `recordings`：录像管理页，录像仍需用户显式开始。

## 14. 测试方法

语法检查：

```powershell
node --check src/server.js
node --check server.js
node --check src/skill-manager.js
node --check src/round4-api-foundation.js
node --check electron-main.js
node --check dev.js
node --check skills/qwen-vl.js
python -m py_compile skills/yolo-safety.py
python -m py_compile legacy/backend.py
python -m py_compile scripts/query-alerts.py
python -m py_compile scripts/seed-test-alert.py
```

功能测试：

```powershell
python tests/test-yolo-safety-governance.py
node tests/test-round4-api-foundation.js
node tests/test-round5-page-migration.js
node tests/test-round6-e2e-validation.js
node tests/test-round7-dashboard-main-ui.js
npm test
```

证书准备：

```powershell
node scripts/ensure-test-cert.js
```

## 15. 常见问题

- 端口被占用：不要全局杀进程，先确认是否已有健康实例；如果旧实例不健康，可改用 dev.js 自动选择的替代端口。
- nginx 证书缺失：运行 `node scripts/ensure-test-cert.js` 生成本地测试证书。
- Python 不可用：确认 `python --version` 可执行；Windows 可尝试 `py -3`。
- YOLO 模型不存在：开发环境会回退到默认模型，但 PPE / 火灾识别准确性不能保证。
- `/api/frame` 无画面：没有摄像头推流或最新帧时会返回 `404 No frame available`，不等于服务失败。
- Qwen key 未配置：Qwen 技能会安全失败或提示缺少环境变量，不会使用硬编码密钥。
- 事件中心无数据：可运行 `python scripts/seed-test-alert.py` 生成一条测试事件。
- 摄像头无法打开：确认浏览器支持 WebRTC、页面通过 HTTPS 或 localhost 访问，并检查是否出现 `RTCPeerConnection is not a constructor` 等浏览器兼容错误。
- 服务未打开弹窗：优先访问 `https://127.0.0.1:8443/dashboard`，不要访问旧的 502 端口。

## 16. 如何安全关闭

本轮运行交付不会关闭服务。如需手动关闭：

- 关闭启动项目的 PowerShell / 终端窗口。
- 退出 Electron 窗口。
- 只停止本项目启动并记录的 PID。
- 禁止使用 `taskkill /IM node.exe`。
- 禁止全局杀 nginx。
- 禁止清空 `data/alerts.db`、`data/snapshots/`、`recordings/`。

## 17. 当前运行状态

见 `docs/CODEX_RUNTIME_STATUS.md`。

## 18. 下一轮优化建议

P0：

- 将事件 `video_path` 与录像片段自动关联。
- 在事件中心支持录像片段查询和回放联动。

P1：

- 打通 Qwen 复核闭环：`needsReview` -> `qwen-vl.js` -> 更新 `reviewed_by_qwen` / `qwen_result`。
- 页面展示复核状态。

P2：

- 增加真实 metrics API。
- 迁移 `performance_monitor.html`。
- 增加运行态数据清理脚本。

P3：

- 如产品明确需要，再设计登录 / 鉴权。
- 整理生产部署配置。

## Round9 摄像头和 .env 运行补充

### WebRTC 推流

摄像头推流页是 `https://127.0.0.1:8443/` 或局域网 HTTPS 地址。页面必须通过 HTTPS 或 localhost 打开；不要直接用 `file://` 打开。浏览器建议使用 Chrome/Edge。若看到 `RTCPeerConnection is not a constructor`，通常是浏览器环境不支持、页面非安全上下文或原生 WebRTC 构造器被覆盖。本轮已改为安全解析原生 PeerConnection 并输出清晰错误。

### 实时画面

Dashboard 主界面 `https://127.0.0.1:8443/dashboard` 使用 `/api/frame` 和 `/api/cameras/:id/frame` 刷新画面。WebRTC 推流连接后，后端会创建 `webrtc-N` 摄像头并自动设为 active；如果 active 没有帧但其他摄像头有帧，dashboard 会优先显示有帧摄像头。

### 摄像头源配置

进入 `/settings`，在“摄像头源配置”中可以新增 RTSP/IP/URL 摄像头，支持 label、RTSP URL、IP、端口、路径、用户名、密码。操作按钮包括：新增/编辑、启动测试、停止、设为 active、删除。配置保存到 `data/cameras.json`，该文件是运行态数据，不提交 Git。

### `.env` 配置

运行前复制：

```powershell
copy .env.example .env
```

常用项：

- `NODE_PORT=8082`
- `NGINX_PORT=8443`
- `QWEN_API_KEY=` / `DASHSCOPE_API_KEY=`
- `QWEN_MODEL=qwen-vl-plus`
- `CYPHER_YOLO_MODEL=` / `CYPHER_YOLO_PPE_MODEL=` / `CYPHER_YOLO_FIRE_MODEL=`
- `FFMPEG_PATH=`
- `DEFAULT_RTSP_URL=`

不要把真实 key 写入源码、README、docs 或 `.env.example`。

### 精简副本

已生成：`D:\test\NEW-project`。

运行方式：

```powershell
Set-Location 'D:\test\NEW-project'
npm install
copy .env.example .env
node scripts/ensure-test-cert.js
npm run dev
```

该副本默认不包含 `.env`、`node_modules/`、`.git/`、`bin/`、`data/`、`recordings/`、日志、真实证书、旧 Vigil 项目。
