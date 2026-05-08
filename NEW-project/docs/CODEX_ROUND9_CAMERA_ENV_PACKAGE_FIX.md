# CYPHER Round9 摄像头链路、环境配置与精简打包修复报告

## 1. 本轮问题清单

1. 浏览器摄像头推流时报错：`连接失败: RTCPeerConnection is not a constructor`。
2. 新版 dashboard 的“实时画面”在收到真实帧后仍可能显示等待状态。
3. 检测配置页缺少摄像头源管理能力，无法像 Vigil 一样添加 RTSP/IP/URL 摄像头源。
4. 密钥、端口、模型路径、FFmpeg、默认摄像头等运行配置需要统一进入 `.env`。
5. 项目目录过大，需要复制一个干净可运行副本到 `D:\test\NEW-project`。

## 2. 读取的连续性文档

已读取并交叉确认：

- `docs/CODEX_TASK_CONTEXT.md`
- `docs/CODEX_SECURITY_ROUND1.md`
- `docs/CODEX_VIGIL_ROUND2.md`
- `docs/CODEX_EVENTS_ROUND3.md`
- `docs/CODEX_ROUND4_PRE_MIGRATION_AUDIT.md`
- `docs/CODEX_ROUND4_API_FOUNDATION.md`
- `docs/CODEX_ROUND5_PAGE_MIGRATION.md`
- `docs/CODEX_ROUND6_E2E_VALIDATION.md`
- `docs/CODEX_FULL_TEST_REPORT.md`
- `docs/CODEX_ROUND7_DASHBOARD_MAIN_UI.md`
- `docs/CODEX_RUNBOOK_CN.md`
- `docs/CODEX_RUNTIME_STATUS.md`

`docs/CODEX_ROUND8_REAL_CAMERA_AI_VALIDATION.md` 当前未发现，已记录为缺失的可选连续性文档。

## 3. 实际排查结果

### WebRTC 推流链路

扫描发现浏览器端推流页：

- `html/webrtc-client.html`
- `html/desktop-capture.html`

原先直接执行 `new RTCPeerConnection(...)`。当页面环境中全局 `RTCPeerConnection` 不存在、被覆盖、不是函数，或页面通过非 HTTPS / file:// 打开时，会触发 `RTCPeerConnection is not a constructor`。

修复后浏览器端统一使用：

- `window.RTCPeerConnection`
- `window.webkitRTCPeerConnection`
- `window.mozRTCPeerConnection`

并在构造前检查 `typeof PeerConnection === 'function'`。错误提示已明确说明需要 Chrome/Edge、HTTPS 页面、摄像头权限，不要直接 file:// 打开。

### 实时画面链路

后端 `/offer` 为每个 WebRTC 推流创建动态摄像头 ID，例如 `webrtc-1`。原链路中 `activeCameraId` 仍可能停留在默认 `webrtc`，导致 dashboard 请求 `/api/frame` 时读取的是没有帧的默认摄像头。

修复后：

- 新 WebRTC offer 注册摄像头后立即将该摄像头设为 active。
- `processFrame()` 收到某摄像头第一帧后，如果当前 active 没有帧，会切换到实际有帧的摄像头。
- dashboard 会优先选择 `hasFrame=true` 的摄像头，并在无帧时显示清晰提示。
- 新增测试环境钩子 `CYPHER_TEST_FRAME_ENDPOINT=1`，只在测试环境注册 `/api/test/frame`，把测试 I420 帧送入同一个 `processFrame()`，验证 `/api/frame` 返回 JPEG。

### 摄像头配置链路

新增固定配置存储：

- `src/camera-config-store.js`
- 运行态文件：`data/cameras.json`

安全约束：

- 只能写入固定 `data/cameras.json`。
- 路径使用 `path.resolve` containment 检查。
- 摄像头 URL 返回前会遮蔽 RTSP 密码。
- 日志不输出明文 RTSP 密码。
- settings 页面只调用 CYPHER 摄像头 API，不调用 Vigil 旧接口。

### `.env` 配置链路

已引入 `dotenv` 并在以下入口加载：

- `src/server.js`
- `server.js`
- `dev.js`
- `electron-main.js`
- `skills/qwen-vl.js`

`.env.example` 已补充：

- `NODE_PORT`
- `NGINX_PORT`
- `QWEN_API_KEY`
- `DASHSCOPE_API_KEY`
- `QWEN_MODEL`
- `DASHSCOPE_MODEL`
- YOLO 模型与阈值变量
- `RECORDINGS_DIR`
- `FFMPEG_PATH`
- `DEFAULT_RTSP_URL`
- `DEFAULT_RTSP_LABEL`

本地 `.env` 已创建/补齐空值模板，不包含真实密钥，并由 `.gitignore` 忽略。

## 4. 实现变更

### WebRTC 修复

- `html/webrtc-client.html`：增加安全的 PeerConnection 构造器解析、HTTPS/权限检查、清晰错误提示。
- `html/desktop-capture.html`：同样增加安全的 PeerConnection 构造器解析和屏幕捕获环境检查。

### 实时画面修复

- `src/server.js` / `server.js`：新 WebRTC 摄像头设为 active。
- `src/server.js` / `server.js`：`processFrame()` 成功接收帧后在必要时切换 active camera。
- `src/server.js` / `server.js`：`/api/frame` 和 `/api/cameras/:id/frame` 返回 `image/jpeg`、`Cache-Control: no-store`、`X-Camera-Id`。
- `html/dashboard.html`：优先选择有帧摄像头，`/api/frame` 无帧时显示“等待摄像头帧”与操作提示。

### settings 摄像头源配置

`html/settings.html` 已新增：

- 摄像头列表和 active camera 状态。
- 新增摄像头：label、source type、RTSP URL、IP、端口、路径、用户名、密码。
- IP 模式前端辅助拼接 RTSP URL。
- 编辑 label/url。
- 删除摄像头。
- 启动摄像头。
- 停止摄像头。
- 设置 active。
- 显示 connected/connecting/error/disconnected、frameCount、error、frame endpoint。

使用 API：

- `GET /api/cameras`
- `POST /api/cameras`
- `PUT /api/cameras/:id`
- `DELETE /api/cameras/:id`
- `POST /api/cameras/:id/start`
- `POST /api/cameras/:id/stop`
- `POST /api/cameras/active`
- `GET /api/cameras/:id/frame`

未恢复：

- `/video_feed`
- `/camera_config`
- `/test_camera`
- FastAPI
- pywebview

### 精简打包

新增：

- `scripts/package-new-project.js`

输出目录：

- `D:\test\NEW-project`

打包策略：

- 生成 staging 后替换目标目录。
- 已存在的目标目录会移动为时间戳备份。
- 默认不复制 `.env`。
- 不复制 `.git/`、`node_modules/`、`bin/`、`data/`、`recordings/`、`logs/`、`Vigil_AI_System/`、运行态证书、运行缓存、旧用户库。
- 复制 `.env.example`、源码、页面、技能、脚本、nginx 配置、核心测试和关键文档。
- 输出 `MANIFEST.md` 和 `RUN_NEW_PROJECT.md`。

本轮实际生成：

- 目标目录：`D:\test\NEW-project`
- 已存在目标备份：`D:\\test\\NEW-project-backup-<timestamp>`
- 复制文件数：58
- 跳过项：12

新目录基础验证：

- `D:\test\NEW-project\package.json` 存在。
- `D:\test\NEW-project\src\server.js` 存在。
- `D:\test\NEW-project\html\dashboard.html` 存在。
- `D:\test\NEW-project\.env.example` 存在。
- `D:\test\NEW-project\README.md` 存在。
- `D:\test\NEW-project\MANIFEST.md` 存在。
- `node --check src/server.js` 通过。
- `node --check electron-main.js` 通过。
- `python -m py_compile skills/yolo-safety.py` 通过。

## 5. 修改文件列表

- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `src/server.js`
- `server.js`
- `src/camera-config-store.js`
- `dev.js`
- `electron-main.js`
- `skills/qwen-vl.js`
- `html/webrtc-client.html`
- `html/desktop-capture.html`
- `html/dashboard.html`
- `html/settings.html`
- `scripts/package-new-project.js`
- `tests/test-round9-camera-env-package-fix.js`
- `README.md`
- `docs/CODEX_TASK_CONTEXT.md`
- `docs/CODEX_RUNBOOK_CN.md`
- `docs/CODEX_FULL_TEST_REPORT.md`
- `docs/CODEX_ROUND9_CAMERA_ENV_PACKAGE_FIX.md`

## 6. 测试命令与结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --check src/server.js` | 通过 | 主后端语法通过 |
| `node --check server.js` | 通过 | root 兼容入口同步通过 |
| `node --check src/skill-manager.js` | 通过 | 技能管理语法通过 |
| `node --check src/round4-api-foundation.js` | 通过 | Round4 API 模块通过 |
| `node --check electron-main.js` | 通过 | Electron 主进程语法通过 |
| `node --check dev.js` | 通过 | dev 启动脚本语法通过 |
| `node --check skills/qwen-vl.js` | 通过 | Qwen 技能语法通过 |
| `node --check scripts/package-new-project.js` | 通过 | 精简打包脚本语法通过 |
| `node --check tests/test-round9-camera-env-package-fix.js` | 通过 | Round9 测试语法通过 |
| `python -m py_compile skills/yolo-safety.py legacy/backend.py scripts/query-alerts.py scripts/seed-test-alert.py` | 通过 | Python 编译检查通过 |
| `python tests/test-yolo-safety-governance.py` | 通过 | 8 项治理测试通过 |
| `node tests/test-round4-api-foundation.js` | 通过 | Round4 API 测试通过 |
| `node tests/test-round5-page-migration.js` | 通过 | 页面迁移静态测试通过 |
| `node tests/test-round6-e2e-validation.js` | 通过 | E2E 验证测试通过 |
| `node tests/test-round9-camera-env-package-fix.js` | 通过 | WebRTC 页面、帧缓存、摄像头配置、dotenv、打包规则测试通过 |
| `npm test` | 通过 | 16 passed, 0 failed |
| `node scripts/package-new-project.js` | 通过 | 已生成 `D:\test\NEW-project` |
| 新目录 `node --check src/server.js` | 通过 | 精简副本后端可解析 |
| 新目录 `node --check electron-main.js` | 通过 | 精简副本 Electron 入口可解析 |
| 新目录 `python -m py_compile skills/yolo-safety.py` | 通过 | 精简副本 Python 技能可编译 |

## 7. 安全回归扫描结果

| 扫描项 | 结果 | 分类 |
|---|---|---|
| 全局杀进程危险命令 | 仅命中文档禁止说明 | 安全 |
| 硬编码密钥 | 仅命中 `bin/...LICENSES.chromium.html` 的 license URL 误报 | 安全 |
| 自动录像回归 | 无命中 | 安全 |
| 技能自动启用回归 | 无命中 | 安全 |
| 旧 Vigil 主链路回流 | `html/src/server.js/tests` 中无运行态旧接口；测试中仅有禁止项自检字符串 | 安全 |
| Web 技能安装入口 | 仅 `src/server.js` 和 `server.js` 中早期 403 禁用路由命中 | 安全 |
| `.env` / `.env.example` 硬编码真实 key | 无命中 | 安全 |

## 8. 新项目启动方式

进入精简副本：

```powershell
Set-Location 'D:\test\NEW-project'
npm install
copy .env.example .env
node scripts/ensure-test-cert.js
npm run dev
```

主页面：

- `https://127.0.0.1:8443/dashboard`

摄像头推流页：

- `https://127.0.0.1:8443/`

检测配置页：

- `https://127.0.0.1:8443/settings`

## 9. 未完成事项

- 未实际连接用户现场 RTSP 摄像头；本轮验证了配置、启动 API、帧缓存和测试帧链路。
- `video_path` 仍是事件到录像片段联动的预留字段。
- Qwen 自动复核闭环仍未实现，只保留低频复核标记和 JS 技能能力。
- `performance_monitor.html` 仍未迁移。
- 如果真实 API Key 曾经进入 Git 历史或构建产物，需要到 DashScope/Qwen 平台手动轮换。

## 10. 下一轮建议

P0：用现场 RTSP 摄像头做真实拉流验收，确认 ffmpeg 参数与摄像头厂商路径。

P1：事件到录像片段自动关联，补齐 `video_path`。

P2：Qwen 低频复核闭环：`needsReview` -> `qwen-vl.js` -> 更新事件 `reviewed_by_qwen/qwen_result`。

P3：真实 metrics API 和 performance monitor 迁移。



