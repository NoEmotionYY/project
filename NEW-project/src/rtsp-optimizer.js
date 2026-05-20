/**
 * RTSP Camera Stream Optimizer & Tester
 * 
 * Features:
 * - Enhanced connection stability with retry logic
 * - Better error handling and recovery
 * - Connection health monitoring
 * - Automatic reconnection on failure
 * - Performance optimization for ffmpeg
 * - Detailed diagnostics and logging
 */

const fs = require('fs');
const path = require('path');

// Configuration
const RTSP_CONFIG = {
  // Connection settings
  CONNECTION_TIMEOUT: 15000,        // 15 seconds timeout (increased from 10s)
  RECONNECT_DELAY: 3000,            // 3 seconds before reconnect
  MAX_RECONNECT_ATTEMPTS: 5,        // Max reconnection attempts
  HEALTH_CHECK_INTERVAL: 30000,     // Check connection every 30s
  
  // FFmpeg optimization
  FFMPEG_OPTIONS: {
    '-rtsp_transport': 'tcp',       // Use TCP for reliability
    '-max_delay': '500000',         // Max delay in microseconds
    '-buffer_size': '1024000',      // Buffer size in bytes
    '-fflags': '+genpts',           // Generate PTS timestamps
    '-flags': 'low_delay',          // Low delay mode
  },
  
  // Video settings
  VIDEO: {
    WIDTH: 1280,
    HEIGHT: 720,
    FPS: 10,
    QUALITY: 85,                    // JPEG quality (1-100)
  },
  
  // Monitoring
  MONITORING: {
    FRAME_TIMEOUT: 5000,            // Alert if no frame for 5s
    MIN_FPS: 5,                     // Minimum acceptable FPS
    BUFFER_WARNING: 100,            // Warn if buffer exceeds this many frames
  }
};

class RtspOptimizer {
  constructor() {
    this.connectionHealth = new Map(); // Track connection health per camera
    this.reconnectAttempts = new Map(); // Track reconnect attempts
    this.healthCheckTimers = new Map(); // Health check timers
  }

  /**
   * Enhanced RTSP camera start with optimization
   */
  optimizeRtspStart(cam, url, spawn, FFMPEG_PATH, sharp, writeVideoFrame, notifyRtspStatus) {
    const id = cam.id;
    
    // Initialize health tracking
    this.connectionHealth.set(id, {
      status: 'connecting',
      lastFrameTime: null,
      frameCount: 0,
      startTime: Date.now(),
      fps: 0,
      errors: []
    });
    
    this.reconnectAttempts.set(id, 0);
    
    console.log(`[RTSP:${id}] 🚀 Starting optimized connection to: ${this.maskUrl(url)}`);
    
    // Build optimized FFmpeg arguments
    const args = this.buildOptimizedFfmpegArgs(url);
    
    console.log(`[RTSP:${id}] FFmpeg args: ${args.join(' ')}`);
    
    // Spawn FFmpeg with enhanced options
    const rtspProcess = spawn(FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    
    cam.rtspProcess = rtspProcess;
    
    // Frame processing
    const frameSize = RTSP_CONFIG.VIDEO.WIDTH * RTSP_CONFIG.VIDEO.HEIGHT * 4;
    let buffer = Buffer.alloc(0);
    let stderrBuffer = '';
    let frameTimes = []; // For FPS calculation
    
    // Enhanced stdout handler with backpressure management
    rtspProcess.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      
      // Process all complete frames in buffer
      while (buffer.length >= frameSize) {
        const frameData = buffer.slice(0, frameSize);
        buffer = buffer.slice(frameSize);
        
        // Skip if buffer is getting too large (backpressure)
        if (buffer.length > frameSize * RTSP_CONFIG.MONITORING.BUFFER_WARNING) {
          console.warn(`[RTSP:${id}] ⚠️ Buffer overflow, dropping frames`);
          buffer = buffer.slice(-frameSize); // Keep only last frame
          continue;
        }
        
        this.processFrame(cam, id, frameData, sharp, writeVideoFrame, frameTimes);
      }
    });
    
    // Enhanced stderr handler with error parsing
    rtspProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      
      // Parse common RTSP errors
      this.parseRtspErrors(id, text, cam);
      
      // Keep only recent errors
      if (stderrBuffer.length > 2000) {
        stderrBuffer = stderrBuffer.slice(-2000);
      }
    });
    
    // Enhanced error handler
    rtspProcess.on('error', (err) => {
      console.error(`[RTSP:${id}] ❌ FFmpeg process error:`, err.message);
      this.handleConnectionError(cam, id, `FFmpeg启动失败: ${err.message}`, notifyRtspStatus);
    });
    
    // Enhanced exit handler with auto-reconnect
    rtspProcess.on('exit', (code, signal) => {
      console.log(`[RTSP:${id}] 📴 Exit code=${code} signal=${signal}`);
      
      const health = this.connectionHealth.get(id);
      if (health && (cam.status === 'connecting' || cam.status === 'connected')) {
        const errorMsg = code !== 0
          ? `FFmpeg异常退出(code=${code}): ${this.getLastMeaningfulError(stderrBuffer)}`
          : '连接已断开';
        
        this.handleConnectionError(cam, id, errorMsg, notifyRtspStatus);
        
        // Attempt auto-reconnect for unexpected disconnections
        if (code !== 0 && signal !== 'SIGTERM') {
          this.attemptReconnect(cam, id, url, spawn, FFMPEG_PATH, sharp, writeVideoFrame, notifyRtspStatus);
        }
      }
      
      cam.rtspProcess = null;
      notifyRtspStatus();
    });
    
    // Enhanced connection timeout
    setTimeout(() => {
      if (cam.status === 'connecting') {
        console.error(`[RTSP:${id}] Connection timeout (${RTSP_CONFIG.CONNECTION_TIMEOUT}ms)`);
        this.handleConnectionError(
          cam, 
          id, 
          '连接超时，请检查:\n1. RTSP地址是否正确\n2. 摄像头是否在线\n3. 网络连接是否正常',
          notifyRtspStatus
        );
      }
    }, RTSP_CONFIG.CONNECTION_TIMEOUT);
    
    // Start health monitoring
    this.startHealthMonitoring(cam, id, notifyRtspStatus);
    
    return rtspProcess;
  }

  /**
   * Build optimized FFmpeg arguments
   */
  buildOptimizedFfmpegArgs(url) {
    return [
      // Input options
      '-rtsp_transport', RTSP_CONFIG.FFMPEG_OPTIONS['-rtsp_transport'],
      '-max_delay', RTSP_CONFIG.FFMPEG_OPTIONS['-max_delay'],
      '-buffer_size', RTSP_CONFIG.FFMPEG_OPTIONS['-buffer_size'],
      '-fflags', RTSP_CONFIG.FFMPEG_OPTIONS['-fflags'],
      '-flags', RTSP_CONFIG.FFMPEG_OPTIONS['-flags'],
      
      // Input
      '-i', url,
      
      // Output format
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${RTSP_CONFIG.VIDEO.WIDTH}x${RTSP_CONFIG.VIDEO.HEIGHT}`,
      '-r', String(RTSP_CONFIG.VIDEO.FPS),
      
      // Disable audio
      '-an',
      
      // Logging
      '-v', 'error',
      
      // Output to pipe
      'pipe:1'
    ];
  }

  /**
   * Process individual frame with performance tracking
   */
  processFrame(cam, id, frameData, sharp, writeVideoFrame, frameTimes) {
    const now = Date.now();
    
    // Update health tracking
    const health = this.connectionHealth.get(id);
    if (health) {
      health.lastFrameTime = now;
      health.frameCount++;
      
      // Calculate FPS
      frameTimes.push(now);
      if (frameTimes.length > 100) frameTimes.shift(); // Keep last 100 frames
      
      if (frameTimes.length >= 10) {
        const timeSpan = (frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000;
        health.fps = Math.round((frameTimes.length - 1) / timeSpan);
      }
    }
    
    cam.frameCount++;
    
    // Update status on first frame
    if (cam.status !== 'connected') {
      cam.status = 'connected';
      console.log(`[RTSP:${id}] ✅ Connected! Receiving frames (${RTSP_CONFIG.VIDEO.WIDTH}x${RTSP_CONFIG.VIDEO.HEIGHT}@${RTSP_CONFIG.VIDEO.FPS}fps)`);
    }
    
    // Convert to JPEG asynchronously
    sharp(frameData, { 
      raw: { 
        width: RTSP_CONFIG.VIDEO.WIDTH, 
        height: RTSP_CONFIG.VIDEO.HEIGHT, 
        channels: 4 
      } 
    })
      .jpeg({ quality: RTSP_CONFIG.VIDEO.QUALITY })
      .toBuffer()
      .then((jpeg) => {
        cam.latestJpeg = jpeg;
        writeVideoFrame(id, jpeg);
        
        // Log progress
        if (cam.frameCount === 1) {
          console.log(`[RTSP:${id}] 📸 First frame: ${jpeg.length} bytes`);
        } else if (cam.frameCount % 100 === 0) {
          const fps = health ? health.fps : 0;
          console.log(`[RTSP:${id}] 📊 Processed ${cam.frameCount} frames (FPS: ${fps})`);
        }
      })
      .catch((err) => {
        if (cam.frameCount <= 3) {
          console.error(`[RTSP:${id}] ❌ Frame conversion error:`, err.message);
        }
      });
  }

  /**
   * Parse RTSP errors from stderr
   */
  parseRtspErrors(id, text, cam) {
    const health = this.connectionHealth.get(id);
    if (!health) return;
    
    // Common RTSP error patterns
    const errorPatterns = [
      { pattern: /Connection refused/i, message: '连接被拒绝，检查摄像头是否在线' },
      { pattern: /Timeout/i, message: '连接超时，检查网络或RTSP地址' },
      { pattern: /401|Unauthorized/i, message: '认证失败，检查用户名密码' },
      { pattern: /404|Not Found/i, message: 'RTSP流未找到，检查URL路径' },
      { pattern: /Invalid data found/i, message: '无效的RTSP数据流' },
      { pattern: /Resource temporarily unavailable/i, message: '资源暂时不可用' },
    ];
    
    for (const { pattern, message } of errorPatterns) {
      if (pattern.test(text)) {
        console.error(`[RTSP:${id}] ⚠️ ${message}`);
        health.errors.push({ time: Date.now(), message });
        
        // Keep only recent errors
        if (health.errors.length > 10) {
          health.errors.shift();
        }
        
        break;
      }
    }
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(cam, id, errorMessage, notifyRtspStatus) {
    cam.status = 'error';
    cam.error = errorMessage;
    
    console.error(`[RTSP:${id}] ❌ Error: ${errorMessage}`);
    
    // Update health tracking
    const health = this.connectionHealth.get(id);
    if (health) {
      health.status = 'error';
      health.errors.push({ time: Date.now(), message: errorMessage });
    }
    
    notifyRtspStatus();
  }

  /**
   * Attempt automatic reconnection
   */
  attemptReconnect(cam, id, url, spawn, FFMPEG_PATH, sharp, writeVideoFrame, notifyRtspStatus) {
    const attempts = this.reconnectAttempts.get(id) || 0;
    
    if (attempts >= RTSP_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[RTSP:${id}] 🛑 Max reconnection attempts (${RTSP_CONFIG.MAX_RECONNECT_ATTEMPTS}) reached`);
      cam.error = `重连失败：已达到最大重试次数(${RTSP_CONFIG.MAX_RECONNECT_ATTEMPTS})`;
      notifyRtspStatus();
      return;
    }
    
    const delay = RTSP_CONFIG.RECONNECT_DELAY * Math.pow(2, attempts); // Exponential backoff
    console.log(`[RTSP:${id}] 🔄 Reconnecting in ${delay/1000}s... (attempt ${attempts + 1}/${RTSP_CONFIG.MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
      this.reconnectAttempts.set(id, attempts + 1);
      console.log(`[RTSP:${id}] 🔄 Attempting reconnection...`);
      
      // Clear old process
      if (cam.rtspProcess) {
        try { cam.rtspProcess.kill('SIGKILL'); } catch (_) {}
        cam.rtspProcess = null;
      }
      
      // Restart connection
      cam.status = 'connecting';
      cam.error = '';
      this.optimizeRtspStart(cam, url, spawn, FFMPEG_PATH, sharp, writeVideoFrame, notifyRtspStatus);
    }, delay);
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring(cam, id, notifyRtspStatus) {
    // Clear existing timer
    if (this.healthCheckTimers.has(id)) {
      clearInterval(this.healthCheckTimers.get(id));
    }
    
    // Set up periodic health check
    const timer = setInterval(() => {
      const health = this.connectionHealth.get(id);
      if (!health || cam.status !== 'connected') return;
      
      const now = Date.now();
      const timeSinceLastFrame = now - (health.lastFrameTime || 0);
      
      // Check for stale connection
      if (timeSinceLastFrame > RTSP_CONFIG.MONITORING.FRAME_TIMEOUT && health.lastFrameTime) {
        console.warn(`[RTSP:${id}] ⚠️ No frames received for ${timeSinceLastFrame/1000}s`);
        
        // If no frames for too long, trigger reconnect
        if (timeSinceLastFrame > RTSP_CONFIG.MONITORING.FRAME_TIMEOUT * 3) {
          console.error(`[RTSP:${id}] ❌ Connection stale, triggering reconnect`);
          cam.status = 'error';
          cam.error = '连接停滞，正在重新连接...';
          notifyRtspStatus();
          
          // Trigger reconnect
          if (cam.rtspProcess) {
            try { cam.rtspProcess.kill('SIGTERM'); } catch (_) {}
          }
        }
      }
      
      // Check FPS
      if (health.fps > 0 && health.fps < RTSP_CONFIG.MONITORING.MIN_FPS) {
        console.warn(`[RTSP:${id}] ⚠️ Low FPS: ${health.fps} (minimum: ${RTSP_CONFIG.MONITORING.MIN_FPS})`);
      }
    }, RTSP_CONFIG.HEALTH_CHECK_INTERVAL);
    
    this.healthCheckTimers.set(id, timer);
  }

  /**
   * Get connection diagnostics
   */
  getDiagnostics(id) {
    const health = this.connectionHealth.get(id);
    if (!health) return null;
    
    const uptime = Date.now() - health.startTime;
    const avgFps = health.frameCount > 0 ? (health.frameCount / (uptime / 1000)).toFixed(1) : 0;
    
    return {
      id,
      status: health.status,
      uptime: Math.round(uptime / 1000),
      totalFrames: health.frameCount,
      currentFps: health.fps,
      averageFps: parseFloat(avgFps),
      lastFrameAge: health.lastFrameTime ? Date.now() - health.lastFrameTime : null,
      recentErrors: health.errors.slice(-5),
      reconnectAttempts: this.reconnectAttempts.get(id) || 0
    };
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(id) {
    if (this.healthCheckTimers.has(id)) {
      clearInterval(this.healthCheckTimers.get(id));
      this.healthCheckTimers.delete(id);
    }
    this.connectionHealth.delete(id);
    this.reconnectAttempts.delete(id);
  }

  /**
   * Mask URL for logging
   */
  maskUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        return `${parsed.protocol}//${parsed.username || '***'}:***@${parsed.host}${parsed.pathname}`;
      }
      return url;
    } catch (_) {
      return url.replace(/(rtsp:\/\/)([^:@/\s]+):([^@/\s]+)@/i, '$1$2:***@');
    }
  }

  /**
   * Get last meaningful error from stderr
   */
  getLastMeaningfulError(stderr) {
    const lines = stderr.trim().split('\n').filter(l => l.trim());
    return lines[lines.length - 1] || '未知错误';
  }
}

module.exports = new RtspOptimizer();
