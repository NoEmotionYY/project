# NEW-project 接手基线检查报告

审计日期：2026-05-08 15:43:03 +08:00

## 1. 测试结论

- 是否能跑通：部分跑通。`D:\test\NEW-project` 的 Node 后端可在 `https://127.0.0.1:8083` 访问，页面/API 基本可用；`npm test` 显示 16 passed / 0 failed。
- 是否存在阻塞问题：存在。精简副本自身的 nginx 启动前置目录 `nginx/logs` 缺失，`nginx -t` 失败；当前 `https://127.0.0.1:8443` 是旧源目录 nginx 在服务，不是 NEW-project 的 nginx。
- 是否建议继续开发：建议先处理 nginx 运行态目录初始化和测试端口污染问题，再进入下一轮业务开发。
- 本轮没有修改业务代码，没有修复问题，只做审计记录。

## 2. 当前目录与文件完整性

- 当前目录：`D:\test\NEW-project`，目录正确。
- 关键目录存在：`src/`、`html/`、`skills/`、`scripts/`、`nginx/`、`docs/`。
- 关键文件存在：`package.json`、`README.md`、`RUN_NEW_PROJECT.md`、`MANIFEST.md`、`.env.example`。
- `.env`：存在，本轮未从模板复制、未覆盖、未写入真实密钥。
- `node_modules/`：存在，本轮未执行 `npm install`。
- `data/`：存在，属于运行态数据；测试期间更新了 `data/alerts.db` 和测试快照。
- `logs/`：存在，属于运行态日志。
- `recordings/`：不存在。
- 旧目录检查：`.git/` 不存在，`bin/` 不存在，`Vigil_AI_System/` 不存在，未发现精简包污染。
- 运行态证书存在：`cert.pem`、`key.pem`、`nginx/conf/cert.pem`、`nginx/conf/key.pem`。
- `MANIFEST.md` 列出的 58 个 copied files 均存在；当前额外出现的 `.env`、`node_modules/`、`data/`、`logs/`、证书属于运行态产物。
- `skills/skills-state.json` 当前存在，内容为 `qwen-vl` enabled；该文件不是 MANIFEST 复制项，应视作运行态状态文件。

缺失文件：

- `tests/test-round7-dashboard-main-ui.js` 缺失，MANIFEST 也将其列为 missing optional files。
- 可选连续性文档 Round1-7 单轮报告和 runtime 状态文档在精简副本中缺失，详见第 3 节。

## 3. 连续性文档读取情况

已读取：

- `docs/CODEX_TASK_CONTEXT.md`
- `docs/CODEX_RUNBOOK_CN.md`
- `docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`
- `docs/CODEX_FULL_TEST_REPORT.md`
- `README.md`
- `RUN_NEW_PROJECT.md`
- `MANIFEST.md`
- `.env.example`
- `package.json`

缺失：

- `docs/CODEX_SECURITY_ROUND1.md`
- `docs/CODEX_VIGIL_ROUND2.md`
- `docs/CODEX_EVENTS_ROUND3.md`
- `docs/CODEX_ROUND4_API_FOUNDATION.md`
- `docs/CODEX_ROUND5_PAGE_MIGRATION.md`
- `docs/CODEX_ROUND6_E2E_VALIDATION.md`
- `docs/CODEX_ROUND7_DASHBOARD_MAIN_UI.md`
- `docs/CODEX_RUNTIME_STATUS.md`

## 4. 环境检查

- Node：`v20.10.0`，路径 `C:\Program Files\nodejs\node.exe`。
- npm：`10.5.0`，路径 `C:\Program Files\nodejs\npm.cmd`。
- Python：`Python 3.11.7`，路径 `C:\Users\19423\anaconda3\python.exe`。
- 系统 `ffmpeg`：PATH 中未找到，不算基础启动失败；RTSP/录像可能受影响。
- npm 内置 ffmpeg：`node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe` 存在。
- 项目内 nginx：`nginx/bin/nginx-win.exe` 存在。

## 5. 依赖与配置

- `package.json` main：`electron-main.js`。
- `scripts.start`：`electron .`。
- `scripts.dev`：`node dev.js`。
- `scripts.server`：`node src/server.js`。
- `scripts.test`：`node scripts/ensure-test-cert.js && node tests/test-system.js`。
- Round9 测试：`tests/test-round9-camera-env-package-fix.js` 存在。
- `scripts/ensure-test-cert.js`：存在。
- `scripts/package-new-project.js`：存在。
- 依赖：`node_modules/` 已存在，本轮执行 `npm ls --depth=0`，未见 missing / invalid / unmet peer dependency。
- `.env.example` 包含要求项：`NODE_PORT`、`NGINX_PORT`、`QWEN_API_KEY`、`DASHSCOPE_API_KEY`、`QWEN_MODEL`、`DASHSCOPE_MODEL`、`CYPHER_YOLO_MODEL`、`CYPHER_YOLO_PPE_MODEL`、`CYPHER_YOLO_FIRE_MODEL`、`FFMPEG_PATH`、`DEFAULT_RTSP_URL`。
- 敏感密钥扫描：`.env`、`.env.example`、`README.md`、`docs`、`scripts`、`src`、`skills`、`tests` 未命中真实 `sk-` API key。全项目扫描命中 `node_modules` 中 `disk-sk...` 等误报，非 API key。
- 测试证书：`node scripts/ensure-test-cert.js` 输出 `Local test certificate files already exist`；证书已存在，仅用于本地测试。
- `.gitignore` 已忽略：`cert.pem`、`key.pem`、`nginx/conf/cert.pem`、`nginx/conf/key.pem`、`data/`、`logs/`、`recordings/`。
- `.gitignore` 未发现 `skills/skills-state.json` 忽略规则；该文件当前作为运行态状态存在。

## 6. 语法与编译检查结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --check src/server.js` | 通过 | 主后端语法通过 |
| `node --check server.js` | 通过 | root 兼容入口语法通过 |
| `node --check src/skill-manager.js` | 通过 | 技能管理语法通过 |
| `node --check src/round4-api-foundation.js` | 通过 | Round4 API 模块语法通过 |
| `node --check electron-main.js` | 通过 | Electron 主进程语法通过 |
| `node --check dev.js` | 通过 | dev 启动脚本语法通过 |
| `node --check skills/qwen-vl.js` | 通过 | Qwen 技能语法通过 |
| `node --check scripts/ensure-test-cert.js` | 通过 | 证书脚本语法通过 |
| `node --check scripts/package-new-project.js` | 通过 | 精简打包脚本语法通过 |
| `node --check tests/test-system.js` | 通过 | 系统测试语法通过 |
| `node --check tests/test-round4-api-foundation.js` | 通过 | Round4 测试语法通过 |
| `node --check tests/test-round5-page-migration.js` | 通过 | Round5 测试语法通过 |
| `node --check tests/test-round6-e2e-validation.js` | 通过 | Round6 测试语法通过 |
| `node --check tests/test-round7-dashboard-main-ui.js` | 缺失 | 精简副本未包含 |
| `node --check tests/test-round9-camera-env-package-fix.js` | 通过 | Round9 测试语法通过 |
| `python -m py_compile skills/yolo-safety.py` | 通过 | Python 技能可编译 |
| `python -m py_compile scripts/query-alerts.py` | 通过 | 查询脚本可编译 |
| `python -m py_compile scripts/seed-test-alert.py` | 通过 | seed 脚本可编译 |
| `python -m py_compile legacy/backend.py` | 通过 | legacy 文件可编译，不属于主链路 |
| `nginx/bin/nginx-win.exe -p nginx -c conf/nginx-temp.conf -t` | 失败 | `nginx/logs/error.log` 和 `nginx/logs/nginx.pid` 所在目录缺失 |

## 7. 测试结果

| 测试 | 结果 | 说明 |
|---|---|---|
| `python tests/test-yolo-safety-governance.py` | 通过 | 8 项治理测试通过 |
| `node tests/test-round4-api-foundation.js` | 通过 | 5 项 Round4 API foundation 测试通过 |
| `node tests/test-round5-page-migration.js` | 通过 | 页面迁移静态检查通过 |
| `node tests/test-round6-e2e-validation.js` | 通过 | 输出 `Round6 e2e validation checks passed`；含本地 TLS 警告 |
| `node tests/test-round7-dashboard-main-ui.js` | 缺失 | 精简副本未包含 |
| `node tests/test-round9-camera-env-package-fix.js` | 通过 | Round9 camera/env/package 测试通过；含本地 TLS 警告 |
| `npm test` | 通过但有审计 caveat | 16 passed / 0 failed；期间 nginx 报 `nginx/logs/error.log` 缺失。由于 19443 端口已有旧源目录 nginx 进程，nginx 代理部分存在被旧实例污染的可能 |

## 8. 启动与页面/API 检查

启动前端口观察：

- `8082`：已有 `node src/server.js`，父进程指向旧源目录 `dev.js`。
- `8083`：已有 `node src/server.js`，日志显示为 `D:\test\NEW-project` 的 dev 运行，Node 直接入口可访问。
- `8443`：已有 `nginx-win.exe`，命令行指向旧源目录 `C:\Users\19423\...\CYPHER\CYPHER\nginx`，不是 NEW-project。
- `8444`：未监听；`logs/round10-dev.log` 显示 NEW-project nginx 曾因缺少 `nginx/logs` 退出。

本轮没有启动新的长期进程，没有关闭任何已有 node/nginx/electron 进程。

| 路径/API | 结果 | 说明 |
|---|---|---|
| `/` | 可访问 | `8443` 返回 200，但来自旧源目录 nginx；NEW-project 直连 `8083` 返回 200 |
| `/dashboard` | 可访问 | `8443` 返回 200；NEW-project 直连 `8083` 返回 200 |
| `/monitor` | 可访问 | `8443` 返回 200，内容长度与 dashboard 一致；未发现旧 monitor UI 标记 |
| `/settings` | 可访问 | `8443` 返回 200；NEW-project 直连 `8083` 返回 200 |
| `/events` | 可访问 | `8443` 返回 200；NEW-project 直连 `8083` 返回 200 |
| `/recordings` | 可访问 | `8443` 返回 200；NEW-project 直连 `8083` 返回 200 |
| `/api/info` | 可访问 | `8443` 与 NEW-project 直连 `8083` 均返回 200 JSON |
| `/api/cameras` | 可访问 | 返回 200 JSON |
| `/api/frame` | 可接受 | 当前无帧，返回 404 / `No frame available` 类状态，不算服务失败 |
| `/api/analysis` | 可访问 | 返回 200 JSON |
| `/api/events` | 正确 | `Content-Type: text/event-stream`，仍是 SSE |
| `/api/alerts` | 可访问 | 返回 200 JSON 事件列表 |
| `/api/detection/config` | 可访问 | 返回 200 JSON |
| `/api/recordings` | 可访问 | 返回 200 JSON；检查到 `AnyRecording=False`，未发现自动录像 |

额外验证：

- `/dashboard` 未命中 `/video_feed`。
- `/api/skills/install` 和 `/api/skills/install-path` 在 NEW-project 直连 `8083` 上均返回 403。
- `nginx -t` 对 NEW-project 配置失败，说明干净副本当前不能可靠启动自己的 nginx 入口。

## 9. 安全回归扫描

- 全局杀进程：仅命中文档禁止说明；未命中 `taskkill /IM node.exe`、`pkill node`、`killall node`、`wmic ... delete` 运行代码。
- 硬编码 key：`.env`、`.env.example`、README、docs、scripts、src、skills、tests 未命中真实 `sk-` key；全项目扫描只命中 `node_modules` 内 `disk-sk...` 等误报。
- 自动录像：`src/server.js`、`server.js` 未命中 `if (!recorder) ... startVideoRecording` 回归；`/api/recordings` 当前无自动录像状态。
- 技能自动启用：源码扫描未命中 `enabledState[...] = true`、`已安装并启用`、`自动启用`。但当前运行态 `skills/skills-state.json` 已存在且启用了 `qwen-vl`，需要区分为运行态状态，不是源码自动启用命中。
- Web 技能安装：仅 `src/server.js` 和 `server.js` 早期 403 禁用路由命中；页面中未发现 `skill-file-input` 或 `type="file"` 入口。
- 旧 Vigil 接口回流：`html`、`src`、`server.js`、`tests` 未命中旧 Vigil 运行接口；命中仅在文档禁止说明中出现。
- data 目录暴露风险：未命中 `express.static(data)`、`app.use(data)` 或 `/api/snapshots` 静态暴露；命中 `data/snapshots` 的位置为文档说明和测试用例。

## 10. 发现的问题

### P0 阻塞

1. `nginx/logs` 目录缺失导致 NEW-project 自己的 nginx 配置测试失败：`CreateFile() "D:\test\NEW-project\nginx/logs/error.log" failed`，`nginx.pid` 也无法创建。按当前 RUN_NEW_PROJECT 步骤直接 `npm run dev` 时，精简副本的 nginx 入口不能可靠启动。
2. 当前 `https://127.0.0.1:8443` 由旧源目录 nginx 提供，不是 `D:\test\NEW-project`。因此 8443 页面/API 访问不能单独证明精简副本完整跑通。

### P1 必须修

1. `npm test` 虽然通过，但 nginx 代理检查可能被已有旧 nginx 进程污染；测试端口选择/启动校验需要避免复用非本轮、非本目录实例。
2. `tests/test-round7-dashboard-main-ui.js` 缺失，导致 Round7 dashboard 主 UI 的单轮测试无法在精简副本中执行。
3. `skills/skills-state.json` 当前存在并启用了 `qwen-vl`，且 `.gitignore` 未忽略该运行态状态文件；需明确它是否应作为运行态产物忽略，避免“技能默认已启用”的接手误判。

### P2 可优化

1. PATH 中没有系统 `ffmpeg`；虽然 npm 内置 ffmpeg 存在，现场 RTSP/录像验收仍需确认实际调用路径。
2. 可选连续性文档 Round1-7 单轮报告和 `CODEX_RUNTIME_STATUS.md` 未包含在精简副本中，后续接手只能依赖汇总文档。
3. `data/`、`logs/`、证书、`.env`、`node_modules/` 已存在，说明当前目录不是“刚打包后的空运行态”；本轮判断时已按运行态处理。

### P3 后续规划

1. `video_path` 与录像片段仍未闭环关联。
2. Qwen 自动复核闭环仍未打通。
3. 真实 metrics API 和 performance monitor 迁移仍是后续项。

## 11. 不做修改说明

- 本轮没有修改业务代码。
- 本轮没有修复问题。
- 本轮没有新增功能。
- 本轮只做运行态检查、测试执行和文档记录。
- 本轮没有执行 `npm install`，因为 `node_modules/` 已存在。
- 本轮没有复制 `.env`，因为 `.env` 已存在。
- 本轮没有新生成测试证书，`ensure-test-cert` 只确认本地证书已存在。
- 测试期间更新的 `data/alerts.db`、`data/snapshots/`、`logs/server.log` 属于运行态测试数据。

## 12. 下一轮建议

1. 先修复/验证精简副本 nginx 运行态目录初始化：确保干净副本按 `npm install -> copy .env.example .env -> node scripts/ensure-test-cert.js -> npm run dev` 后，NEW-project 自己的 nginx 能在预期端口启动。
2. 清理测试端口污染判断：测试启动 nginx 后应确认 PID/命令行属于 `D:\test\NEW-project`，不能被旧源目录 nginx 误判为通过。
3. 补齐或明确移除 `tests/test-round7-dashboard-main-ui.js` 的连续性要求。
4. 明确 `skills/skills-state.json` 是否是运行态文件，并加入忽略/打包排除说明。
5. 在上述阻塞处理后，再做现场 RTSP 摄像头真实拉流验收、事件 `video_path` 录像片段关联，或 Qwen 自动复核闭环。

## 13. 后续修复记录

- 2026-05-08：已修复 `https://127.0.0.1:8444/dashboard` 拒绝访问的直接原因。
- 修复内容：`dev.js` 启动 nginx 前会自动创建 `nginx/logs` 和 nginx temp 子目录；`tests/test-system.js` 启动测试 nginx 前也会创建相同运行态目录。
- 同步修复：`dev.js` 在选择备用 Node 端口时，会把 nginx 临时配置中的 `/api/events`、`/api/`、`/offer` 代理目标同步到实际 Node 端口，避免 8444 代理到旧的 8082。
- 已在当前工作区创建 `nginx/logs`，并启动 NEW-project nginx：PID `37920`，命令行指向 `D:\test\NEW-project\nginx\conf\nginx-temp.conf`。
- 验证：`node --check dev.js`、`node --check tests/test-system.js`、`nginx -t`、`npm test` 均通过；`https://127.0.0.1:8444/dashboard` 返回 200；`/api/events` 仍为 `text/event-stream`。
