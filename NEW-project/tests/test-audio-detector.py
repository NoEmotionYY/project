#!/usr/bin/env python3
"""
Test script for Audio Detector Module
Tests all major components: device enumeration, configuration, and alert system
"""

import json
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'skills'))

def test_imports():
    """Test that all required modules can be imported"""
    print("Testing imports...")
    try:
        import sounddevice as sd
        print("✓ sounddevice imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import sounddevice: {e}")
        return False
    
    try:
        import numpy as np
        print("✓ numpy imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import numpy: {e}")
        return False
    
    try:
        from PIL import Image, ImageDraw
        print("✓ Pillow imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import Pillow: {e}")
        return False
    
    return True

def test_device_enumeration():
    """Test audio device enumeration"""
    print("\nTesting device enumeration...")
    try:
        # Import using importlib due to hyphen in filename
        import importlib.util
        spec = importlib.util.spec_from_file_location("audio_detector", PROJECT_ROOT / 'skills' / 'audio-detector.py')
        audio_detector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audio_detector)
        
        devices = audio_detector.get_audio_devices()
        print(f"✓ Found {len(devices)} audio input device(s)")
        
        if devices:
            for i, device in enumerate(devices):
                default_marker = " [DEFAULT]" if device['is_default'] else ""
                print(f"  {i+1}. {device['name']}{default_marker}")
                print(f"     Channels: {device['channels']}, Sample Rate: {device['default_samplerate']}")
        else:
            print("  No audio input devices found (this may be normal in some environments)")
        
        return True
    except Exception as e:
        print(f"✗ Device enumeration failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_configuration():
    """Test configuration loading and saving"""
    print("\nTesting configuration management...")
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("audio_detector", PROJECT_ROOT / 'skills' / 'audio-detector.py')
        audio_detector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audio_detector)
        
        # Load current config
        audio_detector.load_config()
        print("✓ Configuration loaded successfully")
        
        # Test saving new config
        audio_detector.save_config(
            device_id=None,
            device_name="Test Microphone",
            alert_cooldown=3.0,
            detection_threshold=-18.0,
            explosion_threshold=-8.0
        )
        print("✓ Configuration saved successfully")
        
        # Reload and verify
        audio_detector.load_config()
        print("✓ Configuration reloaded successfully")
        
        # Check if config file exists
        if audio_detector.CONFIG_FILE.exists():
            with open(audio_detector.CONFIG_FILE, 'r') as f:
                config = json.load(f)
                print(f"  Config file: {audio_detector.CONFIG_FILE}")
                print(f"  Device: {config.get('device_name')}")
                print(f"  Cooldown: {config.get('alert_cooldown')}s")
                print(f"  Detection Threshold: {config.get('detection_threshold')} dBFS")
                print(f"  Explosion Threshold: {config.get('explosion_threshold')} dBFS")
        else:
            print("  Config file not created (may use defaults)")
        
        return True
    except Exception as e:
        print(f"✗ Configuration test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_database():
    """Test database initialization"""
    print("\nTesting database initialization...")
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("audio_detector", PROJECT_ROOT / 'skills' / 'audio-detector.py')
        audio_detector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audio_detector)
        import sqlite3
        
        audio_detector.init_database()
        print("✓ Database initialized successfully")
        
        # Verify database structure
        if audio_detector.ALERT_DB_PATH.exists():
            conn = sqlite3.connect(audio_detector.ALERT_DB_PATH)
            cursor = conn.cursor()
            
            # Check if alerts table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'")
            if cursor.fetchone():
                print("✓ Alerts table exists")
                
                # Get column names
                cursor.execute("PRAGMA table_info(alerts)")
                columns = [row[1] for row in cursor.fetchall()]
                print(f"  Columns: {', '.join(columns[:5])}... ({len(columns)} total)")
            else:
                print("✗ Alerts table not found")
                return False
            
            conn.close()
        else:
            print("✗ Database file not created")
            return False
        
        return True
    except Exception as e:
        print(f"✗ Database test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_snapshot_generation():
    """Test snapshot image generation"""
    print("\nTesting snapshot generation...")
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("audio_detector", PROJECT_ROOT / 'skills' / 'audio-detector.py')
        audio_detector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audio_detector)
        from datetime import datetime, timezone
        
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Test high-volume alert
        snapshot_path = audio_detector.save_alert(-12.5, timestamp, is_explosion=False)
        if snapshot_path:
            print(f"✓ High-volume snapshot created: {snapshot_path}")
        else:
            print("✗ Failed to create high-volume snapshot")
            return False
        
        # Test explosion alert
        snapshot_path = audio_detector.save_alert(-3.0, timestamp, is_explosion=True)
        if snapshot_path:
            print(f"✓ Explosion snapshot created: {snapshot_path}")
        else:
            print("✗ Failed to create explosion snapshot")
            return False
        
        return True
    except Exception as e:
        print(f"✗ Snapshot generation failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("Audio Detector Module - Test Suite")
    print("=" * 60)
    
    results = []
    
    # Run tests
    results.append(("Imports", test_imports()))
    results.append(("Device Enumeration", test_device_enumeration()))
    results.append(("Configuration", test_configuration()))
    results.append(("Database", test_database()))
    results.append(("Snapshot Generation", test_snapshot_generation()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status:8} - {name}")
    
    print("-" * 60)
    print(f"Total: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
