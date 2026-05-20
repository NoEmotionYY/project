import sounddevice as sd
import json

print("=" * 50)
print("音频设备检测")
print("=" * 50)

try:
    devices = sd.query_devices()
    print(f'\n总共找到 {len(devices)} 个设备\n')
    
    input_devices = []
    for i, d in enumerate(devices):
        if d['max_input_channels'] > 0:
            input_devices.append({
                'index': i,
                'name': d['name'],
                'channels': d['max_input_channels'],
                'samplerate': d['default_samplerate'],
                'is_default': (i == sd.default.device[0])
            })
            print(f"[输入设备 #{i}]")
            print(f"  名称: {d['name']}")
            print(f"  通道数: {d['max_input_channels']}")
            print(f"  采样率: {d['default_samplerate']}")
            print(f"  是否默认: {'是' if i == sd.default.device[0] else '否'}")
            print()
    
    if not input_devices:
        print("⚠️  未找到任何音频输入设备！")
        print("\n可能原因：")
        print("1. 系统没有安装麦克风")
        print("2. 麦克风被其他程序占用")
        print("3. Windows 音频服务未启动")
        print("4. 声卡驱动问题")
    else:
        print(f"\n✅ 找到 {len(input_devices)} 个音频输入设备")
        
except Exception as e:
    print(f"\n❌ 错误: {e}")
    print("\n请检查：")
    print("1. sounddevice 库是否正确安装")
    print("2. PortAudio 是否可用")
