// renderer.js
const { ipcRenderer } = require('electron');

// Initialize random display name for UI components
window.randomDisplayName = null;

// Request random display name from main process
ipcRenderer
    .invoke('get-random-display-name')
    .then(name => {
        window.randomDisplayName = name;
        console.log('Set random display name:', name);
    })
    .catch(err => {
        console.warn('Could not get random display name:', err);
        window.randomDisplayName = 'System Monitor';
    });

let mediaStream = null;
let screenshotInterval = null;
let audioContext = null;
let audioProcessor = null;
let micAudioProcessor = null;
let audioBuffer = [];
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // seconds
const BUFFER_SIZE = 4096; // Increased buffer size for smoother audio

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';

// Token tracking system for rate limiting
let tokenTracker = {
    tokens: [], // Array of {timestamp, count, type} objects
    audioStartTime: null,

    // Add tokens to the tracker
    addTokens(count, type = 'image') {
        const now = Date.now();
        this.tokens.push({
            timestamp: now,
            count: count,
            type: type,
        });

        // Clean old tokens (older than 1 minute)
        this.cleanOldTokens();
    },

    // Calculate image tokens based on Gemini 2.0 rules
    calculateImageTokens(width, height) {
        // Images ≤384px in both dimensions = 258 tokens
        if (width <= 384 && height <= 384) {
            return 258;
        }

        // Larger images are tiled into 768x768 chunks, each = 258 tokens
        const tilesX = Math.ceil(width / 768);
        const tilesY = Math.ceil(height / 768);
        const totalTiles = tilesX * tilesY;

        return totalTiles * 258;
    },

    // Track audio tokens continuously
    trackAudioTokens() {
        if (!this.audioStartTime) {
            this.audioStartTime = Date.now();
            return;
        }

        const now = Date.now();
        const elapsedSeconds = (now - this.audioStartTime) / 1000;

        // Audio = 32 tokens per second
        const audioTokens = Math.floor(elapsedSeconds * 32);

        if (audioTokens > 0) {
            this.addTokens(audioTokens, 'audio');
            this.audioStartTime = now;
        }
    },

    // Clean tokens older than 1 minute
    cleanOldTokens() {
        const oneMinuteAgo = Date.now() - 60 * 1000;
        this.tokens = this.tokens.filter(token => token.timestamp > oneMinuteAgo);
    },

    // Get total tokens in the last minute
    getTokensInLastMinute() {
        this.cleanOldTokens();
        return this.tokens.reduce((total, token) => total + token.count, 0);
    },

    // Check if we should throttle based on settings
    shouldThrottle() {
        // Get rate limiting settings from localStorage
        const throttleEnabled = localStorage.getItem('throttleTokens') === 'true';
        if (!throttleEnabled) {
            return false;
        }

        const maxTokensPerMin = parseInt(localStorage.getItem('maxTokensPerMin') || '1000000', 10);
        const throttleAtPercent = parseInt(localStorage.getItem('throttleAtPercent') || '75', 10);

        const currentTokens = this.getTokensInLastMinute();
        const throttleThreshold = Math.floor((maxTokensPerMin * throttleAtPercent) / 100);

        console.log(`Token check: ${currentTokens}/${maxTokensPerMin} (throttle at ${throttleThreshold})`);

        return currentTokens >= throttleThreshold;
    },

    // Reset the tracker
    reset() {
        this.tokens = [];
        this.audioStartTime = null;
    },
};

// Track audio tokens every few seconds
setInterval(() => {
    tokenTracker.trackAudioTokens();
}, 2000);

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function initializeGemini(profile = 'interview', language = 'en-US') {
    const apiKey = localStorage.getItem('apiKey')?.trim();
    if (apiKey) {
        const success = await ipcRenderer.invoke('initialize-gemini', apiKey, localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    console.log('Status update:', status);
    cheddar.setStatus(status);
});

// Listen for responses - REMOVED: This is handled in MixerApp.js to avoid duplicates
// ipcRenderer.on('update-response', (event, response) => {
//     console.log('Gemini response:', response);
//     cheddar.e().setResponse(response);
//     // You can add UI elements to display the response if needed
// });

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Reset token tracker when starting new capture session
    tokenTracker.reset();
    console.log('🎯 Token tracker reset for new capture session');

    const audioMode = localStorage.getItem('audioMode') || 'speaker_only';

    try {
        if (isMacOS) {
            // On macOS, use SystemAudioDump for audio and getDisplayMedia for screen
            console.log('Starting macOS capture with SystemAudioDump...');

            // Start macOS audio capture
            const audioResult = await ipcRenderer.invoke('start-macos-audio');
            if (!audioResult.success) {
                throw new Error('Failed to start macOS audio capture: ' + audioResult.error);
            }

            // Get screen capture for screenshots
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Don't use browser audio on macOS
            });

            console.log('macOS screen capture started - audio handled by SystemAudioDump');

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('macOS microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on macOS:', micError);
                }
            }
        } else if (isLinux) {
            // Linux - use display media for screen capture and try to get system audio
            try {
                // First try to get system audio via getDisplayMedia (works on newer browsers)
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false, // Don't cancel system audio
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });

                console.log('Linux system audio capture via getDisplayMedia succeeded');

                // Setup audio processing for Linux system audio
                setupLinuxSystemAudioProcessing();
            } catch (systemAudioError) {
                console.warn('System audio via getDisplayMedia failed, trying screen-only capture:', systemAudioError);

                // Fallback to screen-only capture
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }

            // Additionally get microphone input for Linux based on audio mode
            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });

                    console.log('Linux microphone capture started');

                    // Setup audio processing for microphone on Linux
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Linux:', micError);
                    // Continue without microphone if permission denied
                }
            }

            console.log('Linux capture started - system audio:', mediaStream.getAudioTracks().length > 0, 'microphone mode:', audioMode);
        } else {
            // Windows - use display media with loopback for system audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            console.log('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            setupWindowsLoopbackProcessing();

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('Windows microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Windows:', micError);
                }
            }
        }

        console.log('MediaStream obtained:', {
            hasVideo: mediaStream.getVideoTracks().length > 0,
            hasAudio: mediaStream.getAudioTracks().length > 0,
            videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        });

        // Start capturing screenshots - check if manual mode
        if (screenshotIntervalSeconds === 'manual' || screenshotIntervalSeconds === 'Manual') {
            console.log('Manual mode enabled - screenshots will be captured on demand only');
            // Don't start automatic capture in manual mode
        } else {
            const intervalMilliseconds = parseInt(screenshotIntervalSeconds) * 1000;
            screenshotInterval = setInterval(() => captureScreenshot(imageQuality), intervalMilliseconds);

            // Capture first screenshot immediately
            setTimeout(() => captureScreenshot(imageQuality), 100);
        }
    } catch (err) {
        console.error('Error starting capture:', err);
        cheddar.setStatus('error');
    }
}

function setupLinuxMicProcessing(micStream) {
    // Setup microphone audio processing for Linux
    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-mic-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);

    // Store processor reference for cleanup
    micAudioProcessor = micProcessor;
}

function setupLinuxSystemAudioProcessing() {
    // Setup system audio processing for Linux (from getDisplayMedia)
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

function setupWindowsLoopbackProcessing() {
    // Setup audio processing for Windows loopback audio only
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    console.log(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);
    if (!mediaStream) {
        console.warn('No media stream available for screenshot');
        return;
    }

    // Check rate limiting for automated screenshots only
    if (!isManual && tokenTracker.shouldThrottle()) {
        console.log('⚠️ Automated screenshot skipped due to rate limiting');
        return;
    }

    // Check if media stream is still active
    const videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length === 0 || videoTracks[0].readyState === 'ended') {
        console.warn('📸 Media stream is stale, attempting to refresh...');
        const refreshed = await refreshMediaStream();
        if (!refreshed) {
            console.error('❌ Failed to refresh media stream');
            return;
        }
    }

    // Lazy init of video element or refresh if needed
    if (!hiddenVideo || hiddenVideo.srcObject !== mediaStream) {
        console.log('🔄 Initializing/refreshing video element...');
        
        // Clean up old video element if exists
        if (hiddenVideo) {
            hiddenVideo.pause();
            hiddenVideo.srcObject = null;
        }
        
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        
        try {
            await hiddenVideo.play();
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video load timeout'));
                }, 5000); // 5 second timeout
                
                if (hiddenVideo.readyState >= 2) {
                    clearTimeout(timeout);
                    return resolve();
                }
                
                hiddenVideo.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    resolve();
                };
                
                hiddenVideo.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('Video load error'));
                };
            });
            
            console.log('✅ Video element ready:', {
                width: hiddenVideo.videoWidth,
                height: hiddenVideo.videoHeight,
                readyState: hiddenVideo.readyState
            });
        } catch (error) {
            console.error('❌ Failed to initialize video element:', error);
            return;
        }

        // Reinitialize canvas with new video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
        
        console.log('🎨 Canvas initialized:', {
            width: offscreenCanvas.width,
            height: offscreenCanvas.height
        });
    }

    // Double-check video is ready
    if (hiddenVideo.readyState < 2) {
        console.warn('⚠️ Video not ready yet, waiting...');
        
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (hiddenVideo.readyState < 2) {
            console.error('❌ Video still not ready, skipping screenshot');
            return;
        }
    }

    // Capture the frame
    try {
        offscreenContext.drawImage(hiddenVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    } catch (error) {
        console.error('❌ Failed to draw video to canvas:', error);
        return;
    }

    // Enhanced black screen detection
    const imageData = offscreenContext.getImageData(0, 0, Math.min(100, offscreenCanvas.width), Math.min(100, offscreenCanvas.height));
    let totalBrightness = 0;
    let pixelCount = 0;
    
    for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        totalBrightness += (r + g + b) / 3;
        pixelCount++;
    }
    
    const averageBrightness = totalBrightness / pixelCount;
    
    if (averageBrightness < 5) { // Very dark image
        console.warn('⚠️ Screenshot appears to be black (avg brightness:', averageBrightness, ')');
        console.warn('🔄 Attempting to refresh media stream...');
        
        const refreshed = await refreshMediaStream();
        if (refreshed) {
            console.log('✅ Media stream refreshed, retrying screenshot...');
            // Retry once with refreshed stream
            return captureScreenshot(imageQuality, isManual);
        } else {
            console.error('❌ Failed to refresh media stream, proceeding with black screenshot');
        }
    } else {
        console.log('✅ Screenshot appears valid (avg brightness:', averageBrightness, ')');
    }

    let qualityValue;
    switch (imageQuality) {
        case 'high':
            qualityValue = 0.9;
            break;
        case 'medium':
            qualityValue = 0.7;
            break;
        case 'low':
            qualityValue = 0.5;
            break;
        default:
            qualityValue = 0.7; // Default to medium
    }

    offscreenCanvas.toBlob(
        async blob => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = reader.result.split(',')[1];

                // Validate base64 data
                if (!base64data || base64data.length < 100) {
                    console.error('Invalid base64 data generated');
                    return;
                }

                const result = await ipcRenderer.invoke('send-image-content', {
                    data: base64data,
                });

                if (result.success) {
                    // Track image tokens after successful send
                    const imageTokens = tokenTracker.calculateImageTokens(offscreenCanvas.width, offscreenCanvas.height);
                    tokenTracker.addTokens(imageTokens, 'image');
                    console.log(`📊 Image sent successfully - ${imageTokens} tokens used (${offscreenCanvas.width}x${offscreenCanvas.height})`);
                } else {
                    console.error('Failed to send image:', result.error);
                }
            };
            reader.readAsDataURL(blob);
        },
        'image/jpeg',
        qualityValue
    );
}

// Function to refresh media stream when it becomes stale
async function refreshMediaStream() {
    console.log('🔄 Refreshing media stream...');
    
    try {
        // Stop the current stream
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => {
                track.stop();
                console.log('🛑 Stopped track:', track.kind, track.readyState);
            });
        }
        
        // Clean up video element
        if (hiddenVideo) {
            hiddenVideo.pause();
            hiddenVideo.srcObject = null;
            hiddenVideo = null;
        }
        
        // Clean up canvas
        offscreenCanvas = null;
        offscreenContext = null;
        
        // Request new screen capture
        const audioMode = localStorage.getItem('audioMode') || 'speaker_only';
        
        if (isMacOS) {
            // macOS - getDisplayMedia for screen only
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Audio handled by SystemAudioDump on macOS
            });
        } else if (isLinux) {
            // Linux - try with audio first, fallback to video only
            try {
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });
            } catch (audioError) {
                console.warn('Failed to get audio with screen share, trying video only...');
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }
        } else {
            // Windows - getDisplayMedia with loopback audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
        }
        
        console.log('✅ New media stream obtained:', {
            hasVideo: mediaStream.getVideoTracks().length > 0,
            hasAudio: mediaStream.getAudioTracks().length > 0,
            videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        });
        
        // Re-setup audio processing if needed
        if (!isMacOS && mediaStream.getAudioTracks().length > 0) {
            if (isLinux) {
                setupLinuxSystemAudioProcessing();
            } else {
                setupWindowsLoopbackProcessing();
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Failed to refresh media stream:', error);
        
        // Show user-friendly message based on error type
        if (error.name === 'NotAllowedError') {
            console.warn('📸 Screen sharing permission denied. Please grant permission to capture screenshots.');
        } else if (error.name === 'NotFoundError') {
            console.warn('📸 No screen sharing source available.');
        } else {
            console.warn('📸 Screen sharing failed:', error.message);
        }
        
        return false;
    }
}

async function captureManualScreenshot(imageQuality = null) {
    console.log('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;
    await captureScreenshot(quality, true); // Pass true for isManual
    // Note: Removed automatic text message sending - now handled by smart response system
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    console.log('🛑 Stopping capture...');
    
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    // Clean up microphone audio processor (Linux only)
    if (micAudioProcessor) {
        micAudioProcessor.disconnect();
        micAudioProcessor = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
            console.log('🛑 Stopped track:', track.kind);
        });
        mediaStream = null;
    }

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            console.error('Error stopping macOS audio:', err);
        });
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
    
    console.log('✅ Capture stopped and cleaned up');
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        console.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        if (result.success) {
            console.log('Text message sent successfully');
        } else {
            console.error('Failed to send text message:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Conversation storage functions using IndexedDB
let conversationDB = null;

async function initConversationStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ConversationHistory', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            conversationDB = request.result;
            resolve(conversationDB);
        };

        request.onupgradeneeded = event => {
            const db = event.target.result;

            // Create sessions store
            if (!db.objectStoreNames.contains('sessions')) {
                const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
                sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function saveConversationSession(sessionId, conversationHistory) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');

    const sessionData = {
        sessionId: sessionId,
        timestamp: parseInt(sessionId),
        conversationHistory: conversationHistory,
        lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const request = store.put(sessionData);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getConversationSession(sessionId) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');

    return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllConversationSessions() {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Sort by timestamp descending (newest first)
            const sessions = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(sessions);
        };
    });
}

// Listen for conversation data from main process
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await saveConversationSession(data.sessionId, data.fullHistory);
        console.log('Conversation session saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving conversation session:', error);
    }
});

// Initialize conversation storage when renderer loads
initConversationStorage().catch(console.error);

// Listen for emergency erase command from main process
ipcRenderer.on('clear-sensitive-data', () => {
    console.log('Clearing renderer-side sensitive data...');
    localStorage.removeItem('apiKey');
    localStorage.removeItem('customPrompt');
    // Consider clearing IndexedDB as well for full erasure
});

// Listen for focus chat input command
ipcRenderer.on('focus-chat-input', () => {
    console.log('Focusing chat input...');
    
    function attemptFocus(retries = 3) {
        // Try to find the chat input through the shadow DOM
        const app = document.querySelector('cheating-daddy-app');
        if (app && app.shadowRoot) {
            const assistantView = app.shadowRoot.querySelector('assistant-view');
            if (assistantView && assistantView.shadowRoot) {
                const textInput = assistantView.shadowRoot.querySelector('#textInput');
                if (textInput) {
                    // Ensure the input is focusable and visible
                    textInput.tabIndex = 0;
                    textInput.style.pointerEvents = 'auto';
                    
                    // Force focus with a small delay to ensure rendering
                    setTimeout(() => {
                        textInput.focus();
                        textInput.click(); // Simulate click to ensure it's activated
                        console.log('Chat input focused successfully');
                    }, 10);
                    return true;
                }
            }
        }
        
        // Fallback: try direct query
        const textInput = document.getElementById('textInput');
        if (textInput) {
            textInput.tabIndex = 0;
            textInput.style.pointerEvents = 'auto';
            setTimeout(() => {
                textInput.focus();
                textInput.click();
                console.log('Chat input focused successfully (fallback)');
            }, 10);
            return true;
        }
        
        // If not found and we have retries left, try again
        if (retries > 0) {
            console.log(`Chat input not found, retrying... (${retries} attempts left)`);
            setTimeout(() => attemptFocus(retries - 1), 100);
            return false;
        }
        
        console.warn('Chat input element not found after all attempts');
        return false;
    }
    
    attemptFocus();
});

// Handle shortcuts based on current view
async function handleShortcut(shortcutKey) {
    // Get current view directly from the app element to avoid circular reference
    const app = document.querySelector('cheating-daddy-app');
    const currentView = app ? app.currentView : 'main';

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            if (app) app.handleStart();
        } else {
            await handleSmartResponse();
        }
    }
}

// Smart response handler - analyzes both screenshot and voice contexts
async function handleSmartResponse() {
    console.log('🧠 Smart response triggered via Ctrl+Enter');
    
    try {
        // Check if we have recent voice question
        const voiceResult = await ipcRenderer.invoke('get-recent-voice-question');
        const hasVoiceQuestion = voiceResult.success && voiceResult.data.isRecent;
        
        let hasScreenshotContext = false;
        
        // Capture screenshot for visual context
        if (mediaStream) {
            console.log('📸 Capturing screenshot for context analysis...');
            const quality = currentImageQuality;
            await captureScreenshot(quality, true);
            hasScreenshotContext = true;
            
            // Small delay to ensure screenshot is processed
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`📋 Context available - Voice: ${hasVoiceQuestion}, Screenshot: ${hasScreenshotContext}`);
        
        // Trigger smart response analysis
        const result = await ipcRenderer.invoke('trigger-smart-response', hasScreenshotContext);
        
        if (result.success) {
            console.log(`✅ Smart response initiated (${result.responseType})`);
            // Use the app element directly instead of cheddar to avoid circular reference
            const app = document.querySelector('cheating-daddy-app');
            if (app) app.setStatus(`Generating ${result.responseType} response...`);
        } else {
            console.error('❌ Failed to trigger smart response:', result.error);
            const app = document.querySelector('cheating-daddy-app');
            if (app) app.setStatus('Error: ' + result.error);
        }
        
    } catch (error) {
        console.error('Error in smart response handler:', error);
        const app = document.querySelector('cheating-daddy-app');
        if (app) app.setStatus('Error processing request');
    }
}

// Project Management Functions
function saveProjectsData(projects) {
    try {
        localStorage.setItem('userProjects', JSON.stringify(projects));
        return true;
    } catch (error) {
        console.error('Error saving projects data:', error);
        return false;
    }
}

function getProjectsData() {
    try {
        const projectsData = localStorage.getItem('userProjects');
        return projectsData ? JSON.parse(projectsData) : [];
    } catch (error) {
        console.error('Error loading projects data:', error);
        return [];
    }
}

function addProject(project) {
    const projects = getProjectsData();
    project.id = Date.now().toString(); // Simple ID generation
    project.createdAt = new Date().toISOString();
    projects.push(project);
    return saveProjectsData(projects);
}

function updateProject(projectId, updatedProject) {
    const projects = getProjectsData();
    const index = projects.findIndex(p => p.id === projectId);
    if (index !== -1) {
        projects[index] = { ...projects[index], ...updatedProject, updatedAt: new Date().toISOString() };
        return saveProjectsData(projects);
    }
    return false;
}

function deleteProject(projectId) {
    const projects = getProjectsData();
    const filteredProjects = projects.filter(p => p.id !== projectId);
    return saveProjectsData(filteredProjects);
}

function getProjectByName(projectName) {
    const projects = getProjectsData();
    return projects.find(project => 
        project.name.toLowerCase().includes(projectName.toLowerCase()) ||
        projectName.toLowerCase().includes(project.name.toLowerCase())
    );
}

function formatProjectsForAI() {
    const projects = getProjectsData();
    if (projects.length === 0) {
        return '';
    }

    let formattedProjects = '\n\n=== MY PROJECTS INFORMATION ===\n\n';
    
    projects.forEach((project, index) => {
        formattedProjects += `PROJECT ${index + 1}: ${project.name}\n`;
        formattedProjects += `Overview: ${project.overview}\n`;
        formattedProjects += `Technologies: ${project.technologies}\n`;
        formattedProjects += `My Role: ${project.role}\n`;
        formattedProjects += `Key Features: ${project.features}\n`;
        formattedProjects += `Challenges & Solutions: ${project.challenges}\n`;
        formattedProjects += `Achievements: ${project.achievements}\n`;
        if (project.metrics) formattedProjects += `Impact/Metrics: ${project.metrics}\n`;
        if (project.teamSize) formattedProjects += `Team Size: ${project.teamSize}\n`;
        if (project.duration) formattedProjects += `Duration: ${project.duration}\n`;
        formattedProjects += '---\n\n';
    });
    
    return formattedProjects;
}

function formatSpecificProjectForAI(projectName) {
    const project = getProjectByName(projectName);
    if (!project) {
        return '';
    }

    let formattedProject = `\n\n=== ${project.name.toUpperCase()} PROJECT DETAILS ===\n\n`;
    formattedProject += `Project Overview: ${project.overview}\n\n`;
    formattedProject += `Technologies Used: ${project.technologies}\n\n`;
    formattedProject += `My Role & Responsibilities: ${project.role}\n\n`;
    formattedProject += `Key Features & Functionality:\n${project.features}\n\n`;
    formattedProject += `Technical Challenges & Solutions:\n${project.challenges}\n\n`;
    formattedProject += `Key Achievements & Results:\n${project.achievements}\n\n`;
    
    if (project.metrics) {
        formattedProject += `Impact & Metrics: ${project.metrics}\n\n`;
    }
    
    if (project.teamSize) {
        formattedProject += `Team Collaboration: ${project.teamSize}\n\n`;
    }
    
    if (project.duration) {
        formattedProject += `Project Timeline: ${project.duration}\n\n`;
    }
    
    return formattedProject;
}

// Create reference to the main app element
const cheatingDaddyApp = document.querySelector('cheating-daddy-app');

// Consolidated cheddar object - all functions in one place
const cheddar = {
    // Element access
    element: () => cheatingDaddyApp,
    e: () => cheatingDaddyApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => cheatingDaddyApp.currentView,
    getLayoutMode: () => cheatingDaddyApp.layoutMode,

    // Status and response functions
    setStatus: text => cheatingDaddyApp.setStatus(text),
    setResponse: response => cheatingDaddyApp.setResponse(response),

    // Core functionality
    initializeGemini,
    startCapture,
    stopCapture,
    sendTextMessage,
    handleShortcut,
    handleSmartResponse,

    // Project management functions
    saveProjectsData,
    getProjectsData,
    addProject,
    updateProject,
    deleteProject,
    getProjectByName,
    formatProjectsForAI,
    formatSpecificProjectForAI,

    // Conversation history functions
    getAllConversationSessions,
    getConversationSession,
    initConversationStorage,

    // Content protection function
    getContentProtection: () => {
        const contentProtection = localStorage.getItem('contentProtection');
        return contentProtection !== null ? contentProtection === 'true' : true;
    },

    // Platform detection
    isLinux: isLinux,
    isMacOS: isMacOS,
};

// Make it globally available
window.cheddar = cheddar;

// Initialize chat input accessibility when DOM is ready
function initializeChatInput() {
    const app = document.querySelector('cheating-daddy-app');
    if (app && app.shadowRoot) {
        const assistantView = app.shadowRoot.querySelector('assistant-view');
        if (assistantView && assistantView.shadowRoot) {
            const textInput = assistantView.shadowRoot.querySelector('#textInput');
            if (textInput) {
                // Ensure the input is focusable
                textInput.tabIndex = 0;
                // Add a small focus event to initialize it
                textInput.addEventListener('focus', function() {
                    this.style.outline = 'none'; // Remove default outline if needed
                }, { once: true });
                console.log('Chat input initialized for focus shortcuts');
                return true;
            }
        }
    }
    return false;
}

// Try to initialize immediately, or wait for components to load
document.addEventListener('DOMContentLoaded', () => {
    // Try immediate initialization
    if (!initializeChatInput()) {
        // If not ready, try again after a short delay
        setTimeout(() => {
            if (!initializeChatInput()) {
                // If still not ready, try again after components are likely loaded
                setTimeout(initializeChatInput, 1000);
            }
        }, 100);
    }
});

// Also try when the app changes views
if (typeof window !== 'undefined') {
    let lastCurrentView = null;
    setInterval(() => {
        const app = document.querySelector('cheating-daddy-app');
        if (app && app.currentView !== lastCurrentView) {
            lastCurrentView = app.currentView;
            if (app.currentView === 'assistant') {
                setTimeout(initializeChatInput, 100);
            }
        }
    }, 500);
}
