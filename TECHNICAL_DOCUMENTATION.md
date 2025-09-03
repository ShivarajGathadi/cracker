# Mixer - Complete Technical Documentation

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture & Core Components](#architecture--core-components)
4. [Audio Capture System](#audio-capture-system)
5. [Stealth & Anti-Detection Features](#stealth--anti-detection-features)
6. [Cross-Platform Implementation](#cross-platform-implementation)
7. [Build & Release Process](#build--release-process)
8. [AI Integration](#ai-integration)
9. [Security & Privacy Features](#security--privacy-features)
10. [Development Workflow](#development-workflow)
11. [Platform-Specific Features](#platform-specific-features)
12. [Performance Optimizations](#performance-optimizations)

---

## 📈 Project Overview

**Mixer** is a sophisticated real-time AI assistant application built with Electron that provides contextual help during video calls, interviews, and meetings. It uses advanced screen capture, system audio recording, and AI processing to deliver intelligent responses while maintaining complete stealth from detection systems.

### 🎯 Core Purpose
- **Real-time AI assistance** during live conversations
- **Stealth operation** to avoid detection in professional/academic settings
- **Cross-platform compatibility** (Windows, macOS, Linux)
- **Professional-grade audio/visual capture** with minimal system impact

---

## 🔧 Technology Stack

### **Frontend Technologies**
```
├── Electron 30.0.5           # Desktop application framework
├── LitElement 2.7.4          # Lightweight web components
├── Highlight.js 11.9.0       # Code syntax highlighting
├── Marked 4.3.0              # Markdown parsing
└── Custom CSS3               # Modern UI styling
```

### **Backend Technologies**
```
├── Node.js                   # Runtime environment
├── Google Gemini 2.0 API     # AI conversation engine
├── SystemAudioDump           # macOS system audio capture
├── Web Audio API             # Browser-based audio processing
└── Native OS APIs            # Platform-specific integrations
```

### **Build & Distribution**
```
├── Electron Forge 7.8.1     # Build automation
├── Squirrel (Windows)        # Windows installer
├── DMG (macOS)              # macOS disk image
├── AppImage (Linux)         # Linux portable application
└── Vitest 1.6.1            # Testing framework
```

### **Development Tools**
```
├── JSDoc                     # Code documentation
├── ESLint                    # Code linting
├── JSDOM 23.2.0             # DOM testing
└── Git                      # Version control
```

---

## 🏗️ Architecture & Core Components

### **Application Structure**
```
src/
├── index.js                  # Main process entry point
├── index.html               # Renderer process HTML
├── preload.js               # Renderer-main bridge
├── config.js                # Configuration management
├── audioUtils.js            # Audio processing utilities
├── components/              # UI components (LitElement)
│   ├── app/                 # Main application components
│   └── views/               # Different view components
└── utils/                   # Core utilities
    ├── gemini.js            # AI integration
    ├── window.js            # Window management
    ├── renderer.js          # Renderer process logic
    ├── processNames.js      # Stealth name generation
    ├── processRandomizer.js # Process obfuscation
    ├── stealthFeatures.js   # Anti-detection measures
    └── prompts.js           # AI prompt management
```

### **Process Architecture**
```
Main Process (Node.js)
├── Window Management
├── IPC Communication
├── System Audio Capture
├── File System Operations
└── Process Stealth Features

Renderer Process (Chromium)
├── UI Components (LitElement)
├── Screen Capture
├── Audio Processing
├── AI Communication
└── User Interactions
```

### **Data Flow**
```
1. Screen Capture → Canvas Processing → Base64 Encoding
2. Audio Capture → PCM Processing → Gemini API
3. AI Response → UI Updates → User Display
4. User Input → Processing → AI Context
```

---

## 🎵 Audio Capture System

### **Multi-Platform Audio Architecture**

#### **macOS Implementation**
```javascript
// Uses SystemAudioDump binary for system audio
const systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
systemAudioProc = spawn(systemAudioPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PROCESS_NAME: 'AudioService' }
});
```

**Features:**
- **System Audio Dump**: External binary (`SystemAudioDump`) captures system-wide audio
- **Stereo to Mono Conversion**: Reduces bandwidth while maintaining quality
- **Real-time Processing**: 100ms chunks at 24kHz sample rate
- **Process Stealth**: Runs with randomized process names

#### **Windows Implementation**
```javascript
// Loopback audio capture via getDisplayMedia
mediaStream = await navigator.mediaDevices.getDisplayMedia({
    audio: {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    }
});
```

**Features:**
- **Loopback Capture**: Uses Windows' built-in audio loopback
- **Browser API Integration**: Leverages Chromium's audio capabilities
- **Echo Cancellation**: Built-in noise reduction
- **Dual Audio Modes**: System audio + microphone simultaneously

#### **Linux Implementation**
```javascript
// Microphone-based capture with optional system audio
const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    }
});
```

**Features:**
- **Primary Microphone**: Main audio source for most scenarios
- **Optional System Audio**: Via display media when supported
- **Fallback Architecture**: Graceful degradation when permissions denied

### **Audio Processing Pipeline**

#### **1. Raw Audio Capture**
```javascript
// PCM audio data at 24kHz, 16-bit, mono
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const CHUNK_DURATION = 0.1; // 100ms chunks
```

#### **2. Format Conversion**
```javascript
// Convert Float32 to Int16 for Gemini API compatibility
function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = Math.max(-1, Math.min(1, float32Array[i])) * 0x7FFF;
    }
    return int16Array;
}
```

#### **3. Quality Analysis**
```javascript
// Real-time audio quality monitoring
function analyzeAudioBuffer(buffer) {
    return {
        minValue, maxValue,           // Dynamic range
        avgValue, rmsValue,           // Signal strength
        silencePercentage,            // Voice activity detection
        sampleCount                   // Buffer validation
    };
}
```

#### **4. Debug & Monitoring**
```javascript
// Development debugging with WAV export
function saveDebugAudio(buffer, type, timestamp) {
    // Saves PCM, WAV, and JSON metadata
    // Enables audio pipeline debugging
}
```

---

## 🥷 Stealth & Anti-Detection Features

### **Process Name Randomization**
```javascript
// Dynamic process name generation
const prefixes = ['System', 'Desktop', 'Audio', 'Security', 'Helper'];
const suffixes = ['Manager', 'Service', 'Agent', 'Monitor', 'Driver'];
const companies = ['Microsoft', 'Apple', 'Intel', 'NVIDIA', 'Adobe'];

function generateRandomName() {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix} ${suffix}`;
}
```

### **Window Stealth Features**
```javascript
// Window configuration for invisibility
const mainWindow = new BrowserWindow({
    frame: false,                    // No window frame
    transparent: true,               // Transparent background
    alwaysOnTop: true,              // Always visible
    skipTaskbar: true,              // Hidden from taskbar
    hiddenInMissionControl: true,   // Hidden from macOS Mission Control
    setContentProtection: true      // Prevents screenshots
});
```

### **Anti-Detection Measures**

#### **1. Title Randomization**
```javascript
// Window title changes every 30-60 seconds
const stealthTitles = [
    'System Configuration', 'Audio Settings', 'Network Monitor',
    'Performance Monitor', 'Device Manager', 'Security Center'
];

setInterval(() => {
    const randomTitle = stealthTitles[Math.floor(Math.random() * stealthTitles.length)];
    mainWindow.setTitle(randomTitle);
}, 30000 + Math.random() * 30000);
```

#### **2. Process Obfuscation**
```javascript
// Process title masking
process.title = getCurrentRandomName(); // e.g., "Audio Service Helper"

// User agent randomization
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
];
mainWindow.webContents.setUserAgent(randomUA);
```

#### **3. Screen Capture Protection**
```javascript
// Prevents screenshots and screen recording detection
mainWindow.setContentProtection(true);
mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

// Platform-specific hiding
if (process.platform === 'win32') {
    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
}
```

#### **4. Startup Randomization**
```javascript
// Anti-pattern detection
function applyAntiAnalysisMeasures() {
    const delay = 1000 + Math.random() * 3000; // 1-4 second random delay
    return new Promise(resolve => setTimeout(resolve, delay));
}
```

---

## 🌍 Cross-Platform Implementation

### **Platform Detection & Adaptation**
```javascript
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Platform-specific audio capture
if (isMacOS) {
    await startMacOSAudioCapture();
} else if (isWindows) {
    await setupWindowsLoopbackProcessing();
} else if (isLinux) {
    await setupLinuxMicProcessing();
}
```

### **Configuration Management**
```javascript
// OS-specific config directories
function getConfigDir() {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'mixer-config');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'mixer-config');
    } else {
        return path.join(os.homedir(), '.config', 'mixer-config');
    }
}
```

### **Platform-Specific Features**

#### **Windows**
- **Squirrel Installer**: Auto-updating installer with desktop shortcuts
- **Loopback Audio**: Native Windows audio routing
- **Screen Saver Priority**: Highest window priority level
- **Registry Integration**: Proper Windows application integration

#### **macOS**
- **SystemAudioDump**: Dedicated system audio capture binary
- **Mission Control Hiding**: Invisible in window management
- **Code Signing Ready**: Prepared for macOS distribution
- **Entitlements**: Microphone and network permissions configured

#### **Linux**
- **AppImage Distribution**: Self-contained portable application
- **PulseAudio Integration**: Linux audio system compatibility
- **X11/Wayland Support**: Display server compatibility
- **Desktop Integration**: Proper Linux desktop environment support

---

## 🚀 Build & Release Process

### **Development Commands**
```bash
npm start          # Development mode with hot reload
npm run package    # Create platform-specific packages
npm run make       # Build installers for all platforms
npm run publish    # Distribute releases (configured)
npm test          # Run test suite
```

### **Electron Forge Configuration**
```javascript
// forge.config.js
module.exports = {
    packagerConfig: {
        asar: true,                              // Archive app source
        extraResource: ['./src/assets/SystemAudioDump'], // Include binaries
        name: 'Mixer',
        icon: 'src/assets/logo'                  // App icon
    },
    makers: [
        '@electron-forge/maker-squirrel',        // Windows installer
        '@electron-forge/maker-dmg',            // macOS disk image
        '@reforged/maker-appimage'              // Linux AppImage
    ],
    plugins: [
        '@electron-forge/plugin-auto-unpack-natives', // Native modules
        '@electron-forge/plugin-fuses'          // Security features
    ]
};
```

### **Security Fuses**
```javascript
// Enhanced security configuration
new FusesPlugin({
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,                    // Disable Node in renderer
    [FuseV1Options.EnableCookieEncryption]: true,        // Encrypt cookies
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true            // Load only from archive
});
```

### **Distribution Artifacts**

#### **Windows**
```
out/make/squirrel.windows/x64/
├── Mixer-0.4.0 Setup.exe    # Main installer
├── mixer-0.4.0-full.nupkg   # NuGet package
└── RELEASES                           # Update metadata
```

#### **macOS**
```
out/make/
├── Mixer-0.4.0.dmg          # Disk image installer
└── darwin-x64/                       # Application bundle
```

#### **Linux**
```
out/make/
├── Mixer-0.4.0.AppImage     # Portable application
└── linux-x64/                        # Application directory
```

---

## 🤖 AI Integration

### **Google Gemini 2.0 Flash Live Integration**
```javascript
const { GoogleGenAI } = require('@google/genai');

// Real-time conversation setup
const genAI = new GoogleGenAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    systemInstruction: getSystemPrompt() 
});

const session = await model.startChat({
    generationConfig: {
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1000
    }
});
```

### **Multi-Modal Input Processing**
```javascript
// Send combined audio and visual data
await session.sendRealtimeInput({
    audio: {
        data: base64AudioData,
        mimeType: 'audio/pcm;rate=24000'
    }
});

await session.sendMessage([
    { text: transcriptionText },
    { inlineData: { 
        data: base64ImageData, 
        mimeType: 'image/jpeg' 
    }}
]);
```

### **Conversation Management**
```javascript
// Session tracking and context preservation
function saveConversationTurn(transcription, aiResponse) {
    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim()
    };
    
    conversationHistory.push(conversationTurn);
    
    // Persist to IndexedDB for session recovery
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory
    });
}
```

### **Reconnection & Recovery**
```javascript
// Automatic session recovery with context
async function sendReconnectionContext() {
    const transcriptions = conversationHistory
        .map(turn => turn.transcription)
        .filter(t => t && t.trim().length > 0);
    
    const contextMessage = `Till now all these questions were asked in the interview, answer the last one please:\n\n${transcriptions.join('\n')}`;
    
    await session.sendMessage(contextMessage);
}
```

---

## 🔒 Security & Privacy Features

### **Data Protection**
```javascript
// Local-only data storage
const configDir = getConfigDir(); // OS-specific protected directory
const dataDir = path.join(homeDir, 'cheddar', 'data');

// No cloud storage - everything stays local
function ensureDataDirectories() {
    [configDir, dataDir, imageDir, audioDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}
```

### **Content Protection**
```javascript
// Screen recording prevention
mainWindow.setContentProtection(true);

// Memory protection
webPreferences: {
    nodeIntegration: true,
    contextIsolation: false,
    backgroundThrottling: false,
    webSecurity: true,
    allowRunningInsecureContent: false
}
```

### **Network Security**
```javascript
// HTTPS-only communication
const session = require('electron').session;
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith('http://') && !details.url.includes('localhost')) {
        callback({ cancel: true });
    } else {
        callback({});
    }
});
```

### **Process Isolation**
```javascript
// Renderer process sandboxing
const { contextBridge, ipcRenderer } = require('electron');

// Expose only necessary APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateKeybinds: (callback) => ipcRenderer.on('update-keybinds', callback),
    updateKeybinds: (keybinds) => ipcRenderer.send('update-keybinds', keybinds),
    // Limited, secure API surface
});
```

---

## 💻 Development Workflow

### **Testing Strategy**
```javascript
// Unit tests with Vitest
import { describe, it, expect, vi } from 'vitest';

describe('audioUtils', () => {
    it('converts PCM to WAV format correctly', () => {
        const buffer = Buffer.alloc(4);
        const outPath = '/tmp/test.wav';
        pcmToWav(buffer, outPath, 16000, 1, 16);
        // Verify WAV header structure
    });
});

// E2E tests for critical paths
describe('Audio Pipeline E2E', () => {
    it('captures and processes audio end-to-end', () => {
        // Test complete audio capture workflow
    });
});
```

### **Debugging Tools**
```javascript
// Audio debugging utilities
if (process.env.DEBUG_AUDIO) {
    saveDebugAudio(audioBuffer, 'capture_debug');
    analyzeAudioBuffer(audioBuffer, 'Debug Analysis');
}

// Development logging
console.log('🎯 Audio chunk processed:', {
    size: chunk.length,
    timestamp: Date.now(),
    silenceLevel: analysis.silencePercentage
});
```

### **Performance Monitoring**
```javascript
// Token usage tracking
const tokenTracker = {
    reset() { this.totalTokens = 0; },
    addTokens(count) { 
        this.totalTokens += count;
        console.log(`📊 Total tokens used: ${this.totalTokens}`);
    }
};

// Memory usage monitoring
setInterval(() => {
    const usage = process.memoryUsage();
    console.log('Memory usage:', {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`
    });
}, 30000);
```

---

## 🎛️ Platform-Specific Features

### **Windows-Specific**
```javascript
// Windows 10/11 optimizations
if (process.platform === 'win32') {
    // High-priority window management
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    
    // Windows Audio Session API integration
    // Automatic audio device switching
    // Windows Defender exclusion handling
    
    // Registry integration for startup
    app.setLoginItemSettings({
        openAtLogin: false, // User configurable
        path: process.execPath
    });
}
```

### **macOS-Specific**
```javascript
// macOS Monterey+ features
if (process.platform === 'darwin') {
    // Menu bar integration
    app.setName(randomDisplayName);
    
    // SystemAudioDump integration
    const systemAudioPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'SystemAudioDump')
        : path.join(__dirname, '../assets', 'SystemAudioDump');
    
    // Permission handling
    const { systemPreferences } = require('electron');
    const microphoneAccess = systemPreferences.getMediaAccessStatus('microphone');
    
    // Code signing preparation
    // entitlements.plist configuration
}
```

### **Linux-Specific**
```javascript
// Linux distribution compatibility
if (process.platform === 'linux') {
    // PulseAudio integration
    // ALSA fallback support
    // X11/Wayland compatibility
    
    // Desktop file creation
    const desktopEntry = `[Desktop Entry]
Name=Mixer
Exec=${process.execPath}
Icon=${iconPath}
Type=Application
Categories=Education;Development;`;
    
    // AppImage auto-updating
    // Flatpak compatibility layer
}
```

---

## ⚡ Performance Optimizations

### **Memory Management**
```javascript
// Audio buffer size management
const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1; // 1 second max
if (audioBuffer.length > maxBufferSize) {
    audioBuffer = audioBuffer.slice(-maxBufferSize); // Keep recent audio only
}

// Garbage collection optimization
if (global.gc && audioChunkCount % 100 === 0) {
    global.gc(); // Manual GC for long-running sessions
}
```

### **CPU Optimization**
```javascript
// Frame rate limiting for screen capture
const screenshotInterval = setInterval(() => {
    captureScreenshot();
}, screenshotIntervalSeconds * 1000);

// Audio processing throttling
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks
const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

// Background thread utilization
webPreferences: {
    backgroundThrottling: false, // Prevent performance throttling
}
```

### **Network Optimization**
```javascript
// Efficient data transmission
function compressImageData(imageData, quality = 'medium') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Dynamic quality based on network conditions
    const qualityMap = {
        low: 0.3,
        medium: 0.6,
        high: 0.85
    };
    
    return canvas.toDataURL('image/jpeg', qualityMap[quality]);
}

// Adaptive streaming
let adaptiveQuality = 'medium';
if (responseTime > 2000) adaptiveQuality = 'low';
if (responseTime < 500) adaptiveQuality = 'high';
```

---

## 🔮 Future Development Insights

### **Scaling Patterns**
1. **Modular Audio Engines**: Separate audio processing into plugins
2. **Multi-AI Support**: Support for multiple AI providers (OpenAI, Anthropic)
3. **Custom Model Integration**: Local AI model support
4. **Advanced Stealth**: Machine learning-based detection avoidance

### **Architecture Learnings**
1. **IPC Design**: Keep main-renderer communication minimal and structured
2. **State Management**: Centralized configuration with event-driven updates
3. **Error Handling**: Graceful degradation for missing permissions/features
4. **Cross-Platform**: Abstract platform differences early in development

### **Security Considerations**
1. **Process Hardening**: Additional anti-debugging measures
2. **Network Obfuscation**: Traffic pattern randomization
3. **Memory Protection**: Encrypted sensitive data in memory
4. **Behavioral Mimicking**: Normal application usage patterns

---

## 📚 Key Takeaways for Future Projects

### **Electron Best Practices**
```javascript
// 1. Proper IPC Architecture
ipcMain.handle('async-operation', async (event, data) => {
    try {
        const result = await performOperation(data);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 2. Security-First Design
webPreferences: {
    nodeIntegration: false,        // Disable in production
    contextIsolation: true,        // Enable context isolation
    sandbox: true,                 // Sandbox renderer processes
    webSecurity: true              # Enforce web security
}

// 3. Resource Management
app.on('window-all-closed', () => {
    // Cleanup resources before quitting
    stopAllAudioCapture();
    clearAllIntervals();
    if (process.platform !== 'darwin') app.quit();
});
```

### **Audio Processing Architecture**
```javascript
// 1. Platform Abstraction
class AudioCaptureManager {
    static async create(platform) {
        switch(platform) {
            case 'darwin': return new MacOSAudioCapture();
            case 'win32': return new WindowsAudioCapture();
            case 'linux': return new LinuxAudioCapture();
        }
    }
}

// 2. Stream Processing Pipeline
class AudioProcessor {
    constructor() {
        this.pipeline = [
            new NoiseReduction(),
            new VoiceActivityDetection(),
            new FormatConverter(),
            new CompressionOptimizer()
        ];
    }
}
```

### **Cross-Platform Distribution**
```bash
# Automated build pipeline
name: Build and Release
on: [push, pull_request]
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - run: npm run make -- --platform=win32
  
  build-macos:
    runs-on: macos-latest
    steps:
      - run: npm run make -- --platform=darwin
  
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - run: npm run make -- --platform=linux
```

---

This comprehensive documentation provides you with the complete technical blueprint of the **Mixer** application. You can use these patterns, architectures, and implementations as a foundation for building similar cross-platform desktop applications with advanced audio/video processing, AI integration, and stealth capabilities.

The key architectural decisions, security measures, and cross-platform compatibility strategies documented here will serve as valuable reference material for your future projects requiring sophisticated desktop application development.
