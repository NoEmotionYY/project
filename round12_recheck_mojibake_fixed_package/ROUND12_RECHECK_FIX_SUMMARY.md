# 乱码复查与修复包

本包包含 3 个可直接替换的 HTML 修复文件：

- NEW-project/html/dashboard.html
- NEW-project/html/desktop-capture.html
- NEW-project/html/webrtc-client.html

另有脚本：

- apply_mojibake_only_fix.py
- tools/apply_mojibake_only_fix.py

脚本用途：在你本地真实 NEW-project 上修复 server.js、src/server.js 以及上述 HTML 中仍残留的已知乱码，并输出剩余可疑行。

运行方式：

```bash
python apply_mojibake_only_fix.py NEW-project
node --check NEW-project/server.js
node --check NEW-project/src/server.js
```

注意：本次无法直接读取你本地执行替换后的项目目录，也无法 git clone GitHub 仓库（当前环境无法解析 github.com），所以 server.js/src/server.js 提供的是精确替换脚本，不伪造整份后端文件。
