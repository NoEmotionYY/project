
        const isElectron = !!window.electronAPI;
        let BACKEND_URL = isElectron ? 'https://127.0.0.1:8082' : '';

        // Electron 中 file:// 协议下相对链接无效，改为完整 URL
        // 同时获取动态端口
        if (isElectron) {
            window.electronAPI.getPorts().then(ports => {
                if (ports.nodePort) BACKEND_URL = `https://127.0.0.1:${ports.nodePort}`;
                const backLink = document.getElementById('back-monitor-link');
                if (backLink && ports.nginxPort) backLink.href = `https://127.0.0.1:${ports.nginxPort}/dashboard`;
                loadRecordings();
            }).catch(() => {
                // 获取端口失败，使用默认端口
                const backLink = document.getElementById('back-monitor-link');
                if (backLink) backLink.href = 'https://127.0.0.1:8443/dashboard';
                loadRecordings();
            });
        } else {
            // 非 Electron 模式（浏览器访问 nginx），使用相对路径
            loadRecordings();
        }
        let recordings = [];
        let activeCamId = null;
        let selectedFile = null; // { camId, fileName, filePath }
        let agentMessages = [];

        async function loadRecordings() {
            try {
                const resp = await fetch(BACKEND_URL + '/api/recordings');
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const ct = resp.headers.get('content-type') || '';
                if (!ct.includes('application/json')) throw new Error('响应格式错误 (收到 ' + ct + ')');
                const data = await resp.json();
                recordings = data.recordings || [];
                renderSidebar();
                if (activeCamId) renderContent(activeCamId);
            } catch (e) {
                document.getElementById('camera-list').innerHTML =
                    `<div class="empty-files"><i class="fa fa-exclamation-circle"></i>加载失败: ${escapeHtml(e.message)}</div>`;
                document.getElementById('content').innerHTML =
                    `<div class="empty-files"><i class="fa fa-exclamation-circle"></i>API 请求失败，请确认后端已重启</div>`;
            }
        }

        function renderSidebar() {
            const el = document.getElementById('camera-list');
            if (recordings.length === 0) {
                el.innerHTML = `<div class="empty-files"><i class="fa fa-video-camera"></i>暂无摄像头</div>`;
                return;
            }
            el.innerHTML = recordings.map(group => {
                const isActive = group.cameraId === activeCamId;
                const statusClass = group.status || 'unknown';
                return `
                    <div class="camera-item ${isActive ? 'active' : ''}" onclick="selectCamera('${group.cameraId}')">
                        <div class="cam-info">
                            <span class="status-dot ${statusClass}"></span>
                            <div style="min-width:0;">
                                <div class="cam-name">${escapeHtml(group.label || group.cameraId)}</div>
                                <div class="cam-id-tag">${escapeHtml(group.cameraId)}</div>
                            </div>
                            ${group.isRecording ? '<span class="rec-indicator"></span>' : ''}
                        </div>
                        <label class="toggle-switch" onclick="event.stopPropagation();">
                            <input type="checkbox" ${group.isRecording ? 'checked' : ''}
                                onchange="toggleRec('${group.cameraId}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                `;
            }).join('');
        }

        function selectCamera(camId) {
            activeCamId = camId;
            renderSidebar();
            renderContent(camId);
        }

        function renderContent(camId) {
            const group = recordings.find(g => g.cameraId === camId);
            if (!group) return;

            const content = document.getElementById('content');
            content.innerHTML = `
                <div class="content-header">
                    <h2>${escapeHtml(group.label || group.cameraId)} <span style="font-size:13px;color:var(--text-muted);font-weight:400;">(${escapeHtml(group.cameraId)})</span></h2>
                    <span class="meta">${group.files.length} 个文件</span>
                </div>
                ${group.files.length === 0
                    ? `<div class="empty-files"><i class="fa fa-folder-open-o"></i><div>暂无录制文件</div></div>`
                    : `<div class="file-grid">${group.files.map(f => {
                        const isSel = selectedFile && selectedFile.fileName === f.name && selectedFile.camId === group.cameraId;
                        return `
                        <div class="file-card ${isSel ? 'selected' : ''}" onclick="selectFile('${group.cameraId}', '${encodeURIComponent(f.name)}', this)">
                            <div class="file-card-header">
                                <div class="file-icon"><i class="fa fa-file-video-o"></i></div>
                                <div>
                                    <div class="file-card-title">${escapeHtml(f.name)}</div>
                                    <div class="file-card-meta">${f.sizeMb} MB · ${formatTime(f.created)}</div>
                                </div>
                            </div>
                            <div class="file-card-actions">
                                <button class="btn-sm btn-play" onclick="event.stopPropagation();playVideo('${group.cameraId}', '${encodeURIComponent(f.name)}')">
                                    <i class="fa fa-play"></i> 播放
                                </button>
                                <a class="btn-sm btn-download" onclick="event.stopPropagation()"
                                   href="${BACKEND_URL}/api/recordings/${group.cameraId}/${encodeURIComponent(f.name)}" download="${encodeURIComponent(f.name)}">
                                    <i class="fa fa-download"></i> 下载
                                </a>
                                <button class="btn-sm btn-delete" onclick="event.stopPropagation();deleteFile('${group.cameraId}', '${encodeURIComponent(f.name)}')">
                                    <i class="fa fa-trash"></i> 删除
                                </button>
                                <button class="btn-sm btn-agent" onclick="event.stopPropagation();sendFileToAgent('${group.cameraId}', '${encodeURIComponent(f.name)}', '${escapeHtml(f.name)}')">
                                    <i class="fa fa-robot"></i> 分析
                                </button>
                            </div>
                        </div>
                    `}).join('')}</div>`
                }
            `;
        }

        function selectFile(camId, fileName, el) {
            document.querySelectorAll('.file-card').forEach(c => c.classList.remove('selected'));
            if (el) el.classList.add('selected');
            selectedFile = { camId, fileName: decodeURIComponent(fileName), filePath: `${BACKEND_URL}/api/recordings/${camId}/${fileName}` };
            const selEl = document.getElementById('agent-selected-file');
            selEl.textContent = '📹 ' + selectedFile.fileName;
            selEl.classList.add('visible');
        }

        function sendFileToAgent(camId, fileName, displayName) {
            selectFile(camId, fileName, null);
            addAgentMessage('user', `请分析这段视频: ${displayName}`);
            addAgentMessage('bot', '正在分析视频...（Agent 接口待对接）');
            // TODO: 对接 Agent API
            // agentAnalyzeVideo(camId, decodeURIComponent(fileName));
        }

        function addAgentMessage(role, text) {
            const container = document.getElementById('agent-messages');
            // 首次添加消息时清空 placeholder
            if (agentMessages.length === 0) container.innerHTML = '';
            agentMessages.push({ role, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });

            const msgDiv = document.createElement('div');
            msgDiv.className = `agent-msg ${role}`;
            const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            msgDiv.innerHTML = `<div>${escapeHtml(text)}</div><div class="msg-time">${timeStr}</div>`;
            container.appendChild(msgDiv);
            container.scrollTop = container.scrollHeight;
        }

        async function sendAgentMsg() {
            const input = document.getElementById('agent-input');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            addAgentMessage('user', text);
            addAgentMessage('bot', '收到指令，Agent 处理中...（接口待对接）');
            // TODO: 对接 Agent API
            // const resp = await fetch('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message: text, file: selectedFile }) });
        }

        function toggleAgentPanel() {
            const panel = document.getElementById('agent-panel');
            const btn = document.getElementById('agent-toggle-btn');
            panel.classList.toggle('collapsed');
            btn.classList.toggle('active');
        }

        async function toggleRec(camId, shouldRecord) {
            try {
                const url = BACKEND_URL + '/api/recordings/' + camId + (shouldRecord ? '/start' : '/stop');
                const resp = await fetch(url, { method: 'POST' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                loadRecordings();
            } catch (e) {
                alert('操作失败: ' + e.message);
                loadRecordings();
            }
        }

        async function deleteFile(camId, fileName) {
            if (!confirm('确定要删除这个录制文件吗？')) return;
            try {
                const resp = await fetch(BACKEND_URL + '/api/recordings/' + camId + '/' + fileName, { method: 'DELETE' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                loadRecordings();
            } catch (e) {
                alert('删除失败: ' + e.message);
            }
        }

        function playVideo(camId, fileName) {
            const modal = document.getElementById('video-modal');
            const player = document.getElementById('video-player');
            player.src = BACKEND_URL + '/api/recordings/' + camId + '/' + fileName;
            modal.classList.add('active');
            player.play();
        }

        function closeVideo() {
            const modal = document.getElementById('video-modal');
            const player = document.getElementById('video-player');
            player.pause();
            player.src = '';
            modal.classList.remove('active');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatTime(iso) {
            const d = new Date(iso);
            return d.toLocaleString('zh-CN', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        loadRecordings();
        setInterval(loadRecordings, 5000);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVideo(); });
    
