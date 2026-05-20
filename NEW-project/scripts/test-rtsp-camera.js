/**
 * RTSP Camera Stream Tester
 * 
 * Usage:
 * node scripts/test-rtsp-camera.js [rtsp_url]
 * 
 * Example:
 * node scripts/test-rtsp-camera.js rtsp://admin:password@192.168.1.100:554/stream
 */

const { spawn } = require('child_process');
const path = require('path');

// Configuration
const TEST_CONFIG = {
  TIMEOUT: 30000,           // 30 second test
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  VIDEO_WIDTH: 1280,
  VIDEO_HEIGHT: 720,
  VIDEO_FPS: 10,
};

// Get RTSP URL from command line or use test pattern
const rtspUrl = process.argv[2] || 'testsrc';
const isTestPattern = rtspUrl === 'testsrc';

console.log('='.repeat(70));
console.log('RTSP Camera Stream Test');
console.log('='.repeat(70));
console.log();
console.log(`URL: ${isTestPattern ? 'Test Pattern (testsrc)' : rtspUrl}`);
console.log(`Resolution: ${TEST_CONFIG.VIDEO_WIDTH}x${TEST_CONFIG.VIDEO_HEIGHT}`);
console.log(`FPS: ${TEST_CONFIG.VIDEO_FPS}`);
console.log(`Timeout: ${TEST_CONFIG.TIMEOUT / 1000}s`);
console.log();

// Build FFmpeg command
const args = [
  '-rtsp_transport', 'tcp',
  '-max_delay', '500000',
  '-buffer_size', '1024000',
];

if (isTestPattern) {
  args.push(
    '-f', 'lavfi',
    '-i', `testsrc=size=${TEST_CONFIG.VIDEO_WIDTH}x${TEST_CONFIG.VIDEO_HEIGHT}:rate=${TEST_CONFIG.VIDEO_FPS}`,
  );
} else {
  args.push('-i', rtspUrl);
}

args.push(
  '-f', 'rawvideo',
  '-pix_fmt', 'rgba',
  '-s', `${TEST_CONFIG.VIDEO_WIDTH}x${TEST_CONFIG.VIDEO_HEIGHT}`,
  '-r', String(TEST_CONFIG.VIDEO_FPS),
  '-an',
  '-v', 'error',
  'pipe:1'
);

console.log('Starting FFmpeg...');
console.log();

// Spawn FFmpeg
const ffmpeg = spawn(TEST_CONFIG.FFMPEG_PATH, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let frameCount = 0;
let errorCount = 0;
let lastFrameTime = null;
let firstFrameTime = null;
let stderrBuffer = '';
let buffer = Buffer.alloc(0);

const frameSize = TEST_CONFIG.VIDEO_WIDTH * TEST_CONFIG.VIDEO_HEIGHT * 4;

// Handle stdout (video frames)
ffmpeg.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  
  while (buffer.length >= frameSize) {
    const now = Date.now();
    
    if (!firstFrameTime) {
      firstFrameTime = now;
      console.log('✅ First frame received!');
    }
    
    lastFrameTime = now;
    frameCount++;
    buffer = buffer.slice(frameSize);
    
    // Progress update
    if (frameCount % 10 === 0) {
      const elapsed = (now - firstFrameTime) / 1000;
      const fps = (frameCount / elapsed).toFixed(1);
      process.stdout.write(`\r📊 Frames: ${frameCount} | FPS: ${fps} | Elapsed: ${elapsed.toFixed(1)}s`);
    }
  }
});

// Handle stderr (errors and warnings)
ffmpeg.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderrBuffer += text;
  errorCount++;
  
  // Show errors in real-time
  if (text.includes('Error') || text.includes('error') || text.includes('Failed')) {
    console.log('\n❌ Error:', text.trim());
  }
});

// Handle process errors
ffmpeg.on('error', (err) => {
  console.error('\n❌ FFmpeg failed to start:', err.message);
  console.error('\nTroubleshooting:');
  console.error('1. Check if FFmpeg is installed: ffmpeg -version');
  console.error('2. Check if FFmpeg is in PATH');
  console.error('3. Try setting FFMPEG_PATH environment variable');
  process.exit(1);
});

// Handle process exit
ffmpeg.on('exit', (code, signal) => {
  console.log('\n');
  console.log('='.repeat(70));
  console.log('Test Results');
  console.log('='.repeat(70));
  console.log();
  
  if (frameCount > 0) {
    const duration = (lastFrameTime - firstFrameTime) / 1000;
    const avgFps = (frameCount / duration).toFixed(2);
    
    console.log('✅ SUCCESS - Stream is working!');
    console.log();
    console.log(`Total Frames:    ${frameCount}`);
    console.log(`Duration:        ${duration.toFixed(2)}s`);
    console.log(`Average FPS:     ${avgFps}`);
    console.log(`Errors:          ${errorCount}`);
    console.log();
    
    if (parseFloat(avgFps) < TEST_CONFIG.VIDEO_FPS * 0.8) {
      console.log('⚠️  Warning: FPS is lower than expected');
      console.log(`   Expected: ~${TEST_CONFIG.VIDEO_FPS} FPS`);
      console.log(`   Actual:   ${avgFps} FPS`);
      console.log();
      console.log('Possible causes:');
      console.log('  - Network bandwidth insufficient');
      console.log('  - Camera encoding settings');
      console.log('  - System performance');
      console.log();
    }
    
    if (isTestPattern) {
      console.log('💡 Next steps:');
      console.log('  1. Test with your actual RTSP camera URL');
      console.log('  2. Run: node scripts/test-rtsp-camera.js rtsp://your-camera-url');
      console.log();
    } else {
      console.log('💡 Your RTSP stream is working correctly!');
      console.log('   You can now add this camera to your CYPHER system.');
      console.log();
    }
  } else {
    console.log('❌ FAILED - No frames received');
    console.log();
    console.log('Errors encountered:', errorCount);
    console.log();
    
    if (stderrBuffer) {
      console.log('Last error message:');
      const lines = stderrBuffer.trim().split('\n');
      console.log(lines[lines.length - 1]);
      console.log();
    }
    
    console.log('Troubleshooting:');
    console.log('1. Verify RTSP URL is correct');
    console.log('2. Check camera is online and accessible');
    console.log('3. Verify network connectivity');
    console.log('4. Check authentication credentials');
    console.log('5. Try accessing stream with VLC player first');
    console.log();
    
    if (!isTestPattern) {
      console.log('💡 Tip: Test with test pattern first:');
      console.log('   node scripts/test-rtsp-camera.js testsrc');
      console.log();
    }
  }
  
  console.log('='.repeat(70));
  process.exit(frameCount > 0 ? 0 : 1);
});

// Timeout handler
setTimeout(() => {
  console.log('\n\n⏱️  Test timeout reached');
  ffmpeg.kill('SIGTERM');
}, TEST_CONFIG.TIMEOUT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Test interrupted by user');
  ffmpeg.kill('SIGTERM');
  setTimeout(() => {
    process.exit(1);
  }, 500);
});

console.log('Waiting for frames...\n');
