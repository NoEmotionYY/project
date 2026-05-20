#!/usr/bin/env node

/**
 * Organize Snapshots into Reports Directory
 * 
 * This script organizes existing snapshots from data/snapshots/
 * into a structured reports directory with date and type categorization.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(PROJECT_ROOT, 'data', 'snapshots');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'data', 'reports');

// Ensure reports directories exist
function ensureDirectories() {
  const dirs = [
    path.join(REPORTS_DIR, 'yolo-alerts'),
    path.join(REPORTS_DIR, 'audio-alerts'),
    path.join(REPORTS_DIR, 'daily-summaries'),
    path.join(REPORTS_DIR, 'weekly-summaries')
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created: ${path.relative(PROJECT_ROOT, dir)}`);
    }
  });
}

// Extract date from filename
function extractDate(filename) {
  // Pattern: webrtc-1_no-helmet_201331.jpg or audio_alert_2026-05-12T...
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  
  // Try to get from timestamp in name (HHMMSS format)
  const timeMatch = filename.match(/_(\d{6})\.jpg$/);
  if (timeMatch) {
    // Assume today's date for old format
    const today = new Date().toISOString().split('T')[0];
    return today;
  }
  
  return null;
}

// Extract alert type from filename
function extractAlertType(filename) {
  const types = ['no-helmet', 'no-vest', 'fire', 'smoke'];
  for (const type of types) {
    if (filename.includes(type)) return type;
  }
  return 'unknown';
}

// Organize YOLO alerts
function organizeYOLOAlerts() {
  const yoloDir = path.join(SNAPSHOTS_DIR, '2026-05-12');
  
  if (!fs.existsSync(yoloDir)) {
    console.log('⚠ No YOLO alerts directory found');
    return 0;
  }
  
  const files = fs.readdirSync(yoloDir).filter(f => f.endsWith('.jpg'));
  let count = 0;
  
  console.log(`\n📸 Organizing ${files.length} YOLO alert snapshots...`);
  
  files.forEach(file => {
    const date = extractDate(file);
    const alertType = extractAlertType(file);
    
    if (!date) {
      console.warn(`  ⚠ Could not extract date from: ${file}`);
      return;
    }
    
    // Create target directory
    const targetDir = path.join(REPORTS_DIR, 'yolo-alerts', date, alertType);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy file (don't move, keep original)
    const sourcePath = path.join(yoloDir, file);
    const targetPath = path.join(targetDir, file);
    
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      count++;
    }
  });
  
  console.log(`✓ Organized ${count} YOLO alerts`);
  return count;
}

// Organize Audio alerts
function organizeAudioAlerts() {
  const audioDir = path.join(SNAPSHOTS_DIR, '2026', '05', '12', 'audio');
  
  if (!fs.existsSync(audioDir)) {
    console.log('⚠ No audio alerts directory found');
    return 0;
  }
  
  const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.jpg'));
  let count = 0;
  
  console.log(`\n🎵 Organizing ${files.length} audio alert snapshots...`);
  
  files.forEach(file => {
    const date = extractDate(file);
    
    if (!date) {
      console.warn(`  ⚠ Could not extract date from: ${file}`);
      return;
    }
    
    // Create target directory
    const targetDir = path.join(REPORTS_DIR, 'audio-alerts', date);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy file
    const sourcePath = path.join(audioDir, file);
    const targetPath = path.join(targetDir, file);
    
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      count++;
    }
  });
  
  console.log(`✓ Organized ${count} audio alerts`);
  return count;
}

// Generate daily summary
function generateDailySummary(date) {
  const yoloDateDir = path.join(REPORTS_DIR, 'yolo-alerts', date);
  const audioDateDir = path.join(REPORTS_DIR, 'audio-alerts', date);
  
  const summary = {
    date: date,
    generated_at: new Date().toISOString(),
    yolo_alerts: {},
    audio_alerts: 0,
    total_alerts: 0
  };
  
  // Count YOLO alerts by type
  if (fs.existsSync(yoloDateDir)) {
    const alertTypes = fs.readdirSync(yoloDateDir);
    alertTypes.forEach(type => {
      const typeDir = path.join(yoloDateDir, type);
      if (fs.statSync(typeDir).isDirectory()) {
        const count = fs.readdirSync(typeDir).filter(f => f.endsWith('.jpg')).length;
        summary.yolo_alerts[type] = count;
        summary.total_alerts += count;
      }
    });
  }
  
  // Count audio alerts
  if (fs.existsSync(audioDateDir)) {
    const count = fs.readdirSync(audioDateDir).filter(f => f.endsWith('.jpg')).length;
    summary.audio_alerts = count;
    summary.total_alerts += count;
  }
  
  // Save JSON summary
  const jsonPath = path.join(REPORTS_DIR, 'daily-summaries', `${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  
  // Save Markdown summary
  const mdPath = path.join(REPORTS_DIR, 'daily-summaries', `${date}.md`);
  const mdContent = generateMarkdownSummary(summary);
  fs.writeFileSync(mdPath, mdContent);
  
  console.log(`\n📊 Generated daily summary for ${date}`);
  console.log(`   Total alerts: ${summary.total_alerts}`);
  console.log(`   - YOLO: ${Object.values(summary.yolo_alerts).reduce((a, b) => a + b, 0)}`);
  console.log(`   - Audio: ${summary.audio_alerts}`);
  
  return summary;
}

// Generate markdown summary
function generateMarkdownSummary(summary) {
  const lines = [
    `# Daily Alert Summary - ${summary.date}`,
    '',
    `**Generated:** ${new Date(summary.generated_at).toLocaleString('zh-CN')}`,
    '',
    '## 📊 Overview',
    '',
    `**Total Alerts:** ${summary.total_alerts}`,
    '',
    '### YOLO Visual Detection Alerts',
    ''
  ];
  
  Object.entries(summary.yolo_alerts).forEach(([type, count]) => {
    const icons = {
      'no-helmet': '⛑️',
      'no-vest': '🦺',
      'fire': '🔥',
      'smoke': '💨'
    };
    const icon = icons[type] || '📷';
    lines.push(`- ${icon} **${type}:** ${count} alerts`);
  });
  
  lines.push(
    '',
    '### Audio Detection Alerts',
    '',
    `- 🔊 **Audio alerts:** ${summary.audio_alerts}`,
    '',
    '---',
    '',
    '*Report generated automatically by the system*',
    ''
  );
  
  return lines.join('\n');
}

// Main execution
function main() {
  console.log('🗂️  Organizing Snapshots into Reports Directory\n');
  console.log(`Source: ${path.relative(process.cwd(), SNAPSHOTS_DIR)}`);
  console.log(`Target: ${path.relative(process.cwd(), REPORTS_DIR)}\n`);
  
  // Ensure directories exist
  ensureDirectories();
  
  // Organize alerts
  const yoloCount = organizeYOLOAlerts();
  const audioCount = organizeAudioAlerts();
  
  // Generate summaries
  const today = new Date().toISOString().split('T')[0];
  generateDailySummary(today);
  
  // Summary
  console.log('\n✅ Organization complete!');
  console.log(`\n📁 Reports structure:`);
  console.log(`   - YOLO alerts: ${yoloCount} files organized`);
  console.log(`   - Audio alerts: ${audioCount} files organized`);
  console.log(`   - Daily summary: Generated for ${today}`);
  console.log(`\n📂 View reports: ${REPORTS_DIR}`);
  console.log(`   Run: open ${REPORTS_DIR}`);
}

// Run
if (require.main === module) {
  main();
}

module.exports = {
  organizeYOLOAlerts,
  organizeAudioAlerts,
  generateDailySummary
};
