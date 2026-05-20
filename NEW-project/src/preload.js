/**
 * Preload Script
 * 在 renderer 进程和 main 进程之间建立安全的 IPC 通道
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 服务控制
  startServices: () => ipcRenderer.invoke('start-services'),
  startServicesWithPorts: (nodePort, nginxPort) => ipcRenderer.invoke('start-services', nodePort, nginxPort),
  stopServices: () => ipcRenderer.invoke('stop-services'),
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),

  // 状态推送监听
  onServiceStatus: (callback) => {
    ipcRenderer.on('service-status', (_event, value) => callback(value));
  },

  // 监听 RTSP 连接弹窗事件
  onOpenRtspDialog: (callback) => {
    ipcRenderer.on('open-rtsp-dialog', () => callback());
  },

  // 获取本机局域网 IP（用于显示给手机扫码/输入）
  getLanIp: () => ipcRenderer.invoke('get-lan-ip'),

  // 获取实际使用的端口（动态端口切换后）
  getPorts: () => ipcRenderer.invoke('get-ports'),

  // RTSP 流控制
  connectRtsp: (url) => ipcRenderer.invoke('connect-rtsp', url),
  disconnectRtsp: () => ipcRenderer.invoke('disconnect-rtsp'),
  getRtspStatus: () => ipcRenderer.invoke('get-rtsp-status'),

  // RTSP 状态推送监听
  onRtspStatus: (callback) => {
    ipcRenderer.on('rtsp-status', (_event, value) => callback(value));
  },

  // 技能管理
  listSkills: () => ipcRenderer.invoke('list-skills'),
  loadSkill: (skillName) => ipcRenderer.invoke('load-skill', skillName),
  toggleSkill: (skillId, enabled) => ipcRenderer.invoke('toggle-skill', skillId, enabled),
  installSkill: (fileName, content) => ipcRenderer.invoke('install-skill', fileName, content),
  // 文件对话框（Electron 原生）
  openSkillFile: () => ipcRenderer.invoke('open-skill-file'),

  // 技能状态推送监听
  onSkillLoaded: (callback) => {
    ipcRenderer.on('skill-loaded', (_event, value) => callback(value));
  },
  onSkillError: (callback) => {
    ipcRenderer.on('skill-error', (_event, value) => callback(value));
  },
  onSkillList: (callback) => {
    ipcRenderer.on('skill-list', (_event, value) => callback(value));
  },

  // 打开文件夹（用于录制文件）
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
});
