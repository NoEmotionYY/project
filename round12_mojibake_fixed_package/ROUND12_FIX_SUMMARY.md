# Round12 乱码修复说明

本包内容：

- `html/desktop-capture.html`：已修复扫描报告列出的 9 处页面乱码。
- `html/webrtc-client.html`：已修复扫描报告列出的 6 处页面乱码。
- `apply_round12_mojibake_fix.py`：用于在本地 `NEW-project/server.js` 与 `NEW-project/src/server.js` 上执行精确乱码替换。

注意：当前执行环境无法直接 `git clone` 仓库，且 JavaScript raw 文件下载被工具限制，所以没有强行重建完整 `server.js/src/server.js`。后端两份文件请在你的本地仓库根目录运行：

```bash
python apply_round12_mojibake_fix.py NEW-project
node --check NEW-project/server.js
node --check NEW-project/src/server.js
```

脚本只做 exact string replacement，不会重排代码、不改业务逻辑、不改非乱码字段。
