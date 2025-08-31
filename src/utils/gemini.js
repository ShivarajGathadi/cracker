const { GoogleGenAI } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const { CodeAnalyzer } = require('./codeAnalyzer');

// Code analysis instance
const codeAnalyzer = new CodeAnalyzer();
let activeProject = null;

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let isInitializingSession = false;

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Reconnection tracking variables
let reconnectionAttempts = 0;
let maxReconnectionAttempts = 3;
let reconnectionDelay = 2000; // 2 seconds between attempts
let lastSessionParams = null;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Conversation management functions
function initializeNewSession() {
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    conversationHistory = [];
    console.log('New conversation session started:', currentSessionId);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    console.log('Saved conversation turn:', conversationTurn);

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function sendReconnectionContext() {
    if (!global.geminiSessionRef?.current || conversationHistory.length === 0) {
        return;
    }

    try {
        // Gather all transcriptions from the conversation history
        const transcriptions = conversationHistory
            .map(turn => turn.transcription)
            .filter(transcription => transcription && transcription.trim().length > 0);

        if (transcriptions.length === 0) {
            return;
        }

        // Create the context message
        const contextMessage = `Till now all these questions were asked in the interview, answer the last one please:\n\n${transcriptions.join(
            '\n'
        )}`;

        console.log('Sending reconnection context with', transcriptions.length, 'previous questions');

        // Send the context message to the new session
        await global.geminiSessionRef.current.sendRealtimeInput({
            text: contextMessage,
        });
    } catch (error) {
        console.error('Error sending reconnection context:', error);
    }
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

async function attemptReconnection() {
    if (!lastSessionParams || reconnectionAttempts >= maxReconnectionAttempts) {
        console.log('Max reconnection attempts reached or no session params stored');
        sendToRenderer('update-status', 'Session closed');
        return false;
    }

    reconnectionAttempts++;
    console.log(`Attempting reconnection ${reconnectionAttempts}/${maxReconnectionAttempts}...`);

    // Wait before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, reconnectionDelay));

    try {
        const session = await initializeGeminiSession(
            lastSessionParams.apiKey,
            lastSessionParams.customPrompt,
            lastSessionParams.profile,
            lastSessionParams.language,
            true // isReconnection flag
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;
            reconnectionAttempts = 0; // Reset counter on successful reconnection
            console.log('Live session reconnected');

            // Send context message with previous transcriptions
            await sendReconnectionContext();

            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectionAttempts} failed:`, error);
    }

    // If this attempt failed, try again
    if (reconnectionAttempts < maxReconnectionAttempts) {
        return attemptReconnection();
    } else {
        console.log('All reconnection attempts failed');
        sendToRenderer('update-status', 'Session closed');
        return false;
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnection = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    // Store session parameters for reconnection (only if not already reconnecting)
    if (!isReconnection) {
        lastSessionParams = {
            apiKey,
            customPrompt,
            profile,
            language,
        };
        reconnectionAttempts = 0; // Reset counter for new session
    }

    const client = new GoogleGenAI({
        vertexai: false,
        apiKey: apiKey,
    });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled, activeProject);

    // Initialize new conversation session (only if not reconnecting)
    if (!isReconnection) {
        initializeNewSession();
    }

    try {
        const session = await client.live.connect({
            model: 'gemini-live-2.5-flash-preview',
            callbacks: {
                onopen: function () {
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    console.log('----------------', message);

                    if (message.serverContent?.inputTranscription?.results) {
                        currentTranscription += formatSpeakerResults(message.serverContent.inputTranscription.results);
                    }

                    // Handle AI model response
                    if (message.serverContent?.modelTurn?.parts) {
                        for (const part of message.serverContent.modelTurn.parts) {
                            console.log(part);
                            if (part.text) {
                                messageBuffer += part.text;
                                sendToRenderer('update-response', messageBuffer);
                            }
                        }
                    }

                    if (message.serverContent?.generationComplete) {
                        sendToRenderer('update-response', messageBuffer);

                        // Save conversation turn when we have both transcription and AI response
                        if (currentTranscription && messageBuffer) {
                            saveConversationTurn(currentTranscription, messageBuffer);
                            currentTranscription = ''; // Reset for next turn
                        }

                        messageBuffer = '';
                    }

                    if (message.serverContent?.turnComplete) {
                        sendToRenderer('update-status', 'Listening...');
                    }
                },
                onerror: function (e) {
                    console.debug('Error:', e.message);

                    // Check if the error is related to invalid API key
                    const isApiKeyError =
                        e.message &&
                        (e.message.includes('API key not valid') ||
                            e.message.includes('invalid API key') ||
                            e.message.includes('authentication failed') ||
                            e.message.includes('unauthorized'));

                    if (isApiKeyError) {
                        console.log('Error due to invalid API key - stopping reconnection attempts');
                        lastSessionParams = null; // Clear session params to prevent reconnection
                        reconnectionAttempts = maxReconnectionAttempts; // Stop further attempts
                        sendToRenderer('update-status', 'Error: Invalid API key');
                        return;
                    }

                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    console.debug('Session closed:', e.reason);

                    // Check if the session closed due to invalid API key
                    const isApiKeyError =
                        e.reason &&
                        (e.reason.includes('API key not valid') ||
                            e.reason.includes('invalid API key') ||
                            e.reason.includes('authentication failed') ||
                            e.reason.includes('unauthorized'));

                    if (isApiKeyError) {
                        console.log('Session closed due to invalid API key - stopping reconnection attempts');
                        lastSessionParams = null; // Clear session params to prevent reconnection
                        reconnectionAttempts = maxReconnectionAttempts; // Stop further attempts
                        sendToRenderer('update-status', 'Session closed: Invalid API key');
                        return;
                    }

                    // Attempt automatic reconnection for server-side closures
                    if (lastSessionParams && reconnectionAttempts < maxReconnectionAttempts) {
                        console.log('Attempting automatic reconnection...');
                        attemptReconnection();
                    } else {
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: {
                responseModalities: ['TEXT'],
                tools: enabledTools,
                // Enable speaker diarization
                inputAudioTranscription: {
                    enableSpeakerDiarization: true,
                    minSpeakerCount: 2,
                    maxSpeakerCount: 2,
                },
                contextWindowCompression: { slidingWindow: {} },
                speechConfig: { languageCode: language },
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
            },
        });

        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return session;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return null;
    }
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    // Spawn SystemAudioDump with stealth options
    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            // Set environment variables that might help with stealth
            PROCESS_NAME: 'AudioService',
            APP_NAME: 'System Audio Service',
        },
    };

    // On macOS, apply additional stealth measures
    if (process.platform === 'darwin') {
        spawnOptions.detached = false;
        spawnOptions.windowsHide = false;
    }

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = monoChunk.toString('base64');
            sendAudioToGemini(base64Data, geminiSessionRef);

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write('.');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle microphone audio on a separate channel
    ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write(',');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image-content', async (event, { data, debug }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            process.stdout.write('!');
            await geminiSessionRef.current.sendRealtimeInput({
                media: { data: data, mimeType: 'image/jpeg' },
            });

            return { success: true };
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                return { success: false, error: 'Invalid text message' };
            }

            let messageToSend = text.trim();

            // Debug: Check active project status
            console.log(`🔍 DEBUG: Checking active project...`);
            console.log(`🔍 DEBUG: activeProject variable:`, activeProject);
            console.log(`🔍 DEBUG: Total projects in analyzer:`, codeAnalyzer.projects.size);
            if (codeAnalyzer.projects.size > 0) {
                console.log(`🔍 DEBUG: Available projects:`, Array.from(codeAnalyzer.projects.keys()));
            }

            // Smart project detection: Check if user is asking about a specific project by name
            let targetProject = activeProject;
            let allProjectsRequested = false;
            const availableProjects = Array.from(codeAnalyzer.projects.keys());
            
            // Check if user is asking about multiple projects
            const multiProjectKeywords = ['projects', 'tell about your projects', 'all projects', 'both projects'];
            const messageHasMultiProjectKeywords = multiProjectKeywords.some(keyword => 
                messageToSend.toLowerCase().includes(keyword)
            );
            
            if (messageHasMultiProjectKeywords && availableProjects.length > 1) {
                allProjectsRequested = true;
                console.log(`🎯 Detected request for all projects (${availableProjects.length} available)`);
            } else {
                // Look for project names mentioned in the message (case-insensitive and partial matching)
                for (const projectName of availableProjects) {
                    const projectNameLower = projectName.toLowerCase();
                    const messageLower = messageToSend.toLowerCase();
                    
                    console.log(`🔍 Checking project: "${projectName}" against message: "${messageToSend}"`);
                    console.log(`   Project name (lower): "${projectNameLower}"`);
                    console.log(`   Message (lower): "${messageLower}"`);
                    
                    // Extract key words from project name for flexible matching
                    const projectWords = projectNameLower.split(/[\s\-_]+/).filter(word => word.length > 2);
                    console.log(`   Project words: [${projectWords.join(', ')}]`);
                    
                    // Check if any significant project words are mentioned in the message
                    const hasProjectWord = projectWords.some(word => {
                        const found = messageLower.includes(word);
                        console.log(`     Checking word "${word}": ${found}`);
                        return found;
                    });
                    const hasFullName = messageLower.includes(projectNameLower);
                    
                    console.log(`   Has project word: ${hasProjectWord}`);
                    console.log(`   Has full name: ${hasFullName}`);
                    
                    if (hasProjectWord || hasFullName) {
                        targetProject = codeAnalyzer.projects.get(projectName);
                        console.log(`🎯 Detected specific project reference: ${projectName} (matched via: ${projectWords.join(', ')})`);
                        break;
                    }
                }
            }

            // Check if there's a target project (active or detected) and enhance message if it's code-related
            if (allProjectsRequested) {
                console.log('📁 Providing information about all uploaded projects');
                
                // Create comprehensive overview of all projects
                let allProjectsContext = `${text}

**IMPORTANT: You are being asked about ALL uploaded projects. Here are the details for each project:**

`;
                
                availableProjects.forEach((projectName, index) => {
                    const project = codeAnalyzer.projects.get(projectName);
                    allProjectsContext += `
**PROJECT ${index + 1}: ${project.name}**
- **Total Files**: ${project.stats.totalFiles}
- **Lines of Code**: ${project.stats.totalLines.toLocaleString()}
- **Functions**: ${project.stats.functionCount}
- **Classes**: ${project.stats.classCount}
- **File Types**: ${project.stats.languages.join(', ')}

**Key Files:**
${project.files.slice(0, 5).map(file => `- **${file.name}** (${file.lines ? file.lines.length : 0} lines)`).join('\n')}

**Functions Found:**
${project.files.flatMap(file => 
    file.functions ? file.functions.slice(0, 3).map(func => `- \`${func.name}()\` in ${file.name}`) : []
).slice(0, 5).join('\n') || '- No functions detected'}

---
`;
                });
                
                allProjectsContext += `
Please provide a detailed explanation about EACH of these specific uploaded projects based on the analyzed files and content above, not general information.`;

                messageToSend = allProjectsContext;
                
            } else if (targetProject) {
                console.log(`📁 Using project for context: ${targetProject.name}`);
                
                const codeKeywords = [
                    'implementation', 'implement', 'code', 'function', 'class', 'method',
                    'algorithm', 'logic', 'structure', 'architecture', 'pattern',
                    'where is', 'how do you', 'how does', 'what does', 'show me',
                    'find', 'locate', 'file', 'folder', 'directory', 'line',
                    'authentication', 'validation', 'error handling', 'database',
                    'api', 'endpoint', 'route', 'component', 'service', 'utility',
                    'how many', 'count', 'list', 'files', 'classes', 'functions',
                    'which', 'where', 'used'
                ];

                // Project-specific keywords for explaining/describing the project
                const projectKeywords = [
                    'explain', 'describe', 'tell me about', 'what is', 'about your project',
                    'your project', 'this project', 'project does', 'project work',
                    'overview', 'summary', 'purpose', 'goal', 'objective',
                    'what about', 'about', 'tell about', 'details about'
                ];
                
                const messageHasCodeKeywords = codeKeywords.some(keyword => 
                    messageToSend.toLowerCase().includes(keyword)
                );

                const messageHasProjectKeywords = projectKeywords.some(keyword => 
                    messageToSend.toLowerCase().includes(keyword)
                );

                const isProjectRelated = messageHasCodeKeywords || messageHasProjectKeywords || (targetProject && targetProject !== activeProject);
                
                console.log(`🔍 Code keywords detected: ${messageHasCodeKeywords}`);
                console.log(`🔍 Project keywords detected: ${messageHasProjectKeywords}`);
                console.log(`🔍 Specific project detected: ${targetProject && targetProject !== activeProject}`);
                console.log(`📝 Original message: ${messageToSend}`);
                
                if (isProjectRelated) {
                    console.log('🔍 Project-related question detected, enhancing with context...');
                    
                    // For project explanation questions, provide comprehensive project context
                    if (messageHasProjectKeywords) {
                        console.log('� Adding comprehensive project context for explanation');
                        
                        const projectContext = `${text}

**IMPORTANT: You are being asked about the specific uploaded project "${targetProject.name}". Here are the exact details from the analyzed project:**

**Project Overview:**
- **Name**: ${targetProject.name}
- **Total Files**: ${targetProject.stats.totalFiles}
- **Lines of Code**: ${targetProject.stats.totalLines.toLocaleString()}
- **Functions**: ${targetProject.stats.functionCount}
- **Classes**: ${targetProject.stats.classCount}
- **File Types**: ${targetProject.stats.languages.join(', ')}

**Actual Project Files:**
${targetProject.files.map(file => `- **${file.name}** (${file.lines ? file.lines.length : 0} lines)`).join('\n')}

**Functions Found in Project:**
${targetProject.files.flatMap(file => 
    file.functions ? file.functions.map(func => `- \`${func.name}()\` in ${file.name}`) : []
).join('\n') || '- No functions detected'}

**Project Content Summary:**
${targetProject.files.map(file => {
    if (file.name.endsWith('.md')) {
        return `- **${file.name}**: ${file.content.substring(0, 200)}...`;
    }
    return `- **${file.name}**: ${file.extension} file with ${file.functions?.length || 0} functions`;
}).join('\n')}

Please provide a detailed explanation about THIS SPECIFIC PROJECT based on the analyzed files and content above, not general information about similar projects.`;

                        messageToSend = projectContext;
                    } else {
                        // For code-specific questions, try to get specific implementations
                        try {
                            const codeAnswer = await codeAnalyzer.answerCodeQuestion(targetProject.name, messageToSend);
                            
                            console.log(`🎯 Code analysis result: ${codeAnswer.totalMatches} matches found`);
                            
                            if (codeAnswer.totalMatches > 0) {
                                console.log('✅ Found specific code implementations');
                                
                                // Enhance the original message with code context
                                messageToSend = `${text}

**IMPORTANT: I found specific implementations in my analyzed project "${targetProject.name}". Here are the exact locations:**

${codeAnswer.answer}

Please provide a response based on these specific implementations and file locations from the "${targetProject.name}" project.`;
                            } else {
                                // Add general project context even if no specific matches
                                console.log('📊 Adding general project context');
                                messageToSend = `${text}

**Context: I'm asking about the "${targetProject.name}" project which has been analyzed and contains:**
- Total Files: ${targetProject.stats.totalFiles}
- Lines of Code: ${targetProject.stats.totalLines.toLocaleString()}
- Functions: ${targetProject.stats.functionCount}
- Classes: ${targetProject.stats.classCount}
- Technologies: ${targetProject.stats.languages.join(', ')}

Please answer based on this specific project context, not external knowledge.`;
                            }
                        } catch (error) {
                            console.warn('Failed to get code-specific answer:', error);
                            // Still add basic project context
                            messageToSend = `${text}

**Context: I'm asking about the "${targetProject.name}" project.**`;
                        }
                    }
                }
            } else {
                console.log('❌ No active project detected');
            }

            console.log('Sending text message:', messageToSend);
            await geminiSessionRef.current.sendRealtimeInput({ text: messageToSend });
            return { success: true };
        } catch (error) {
            console.error('Error sending text:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();

            // Clear session params to prevent reconnection when user closes session
            lastSessionParams = null;

            // Cleanup any pending resources and stop audio/video capture
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });

    // Code Analysis IPC Handlers
    ipcMain.handle('analyze-project', async (event, { buffer, name }) => {
        try {
            console.log(`🔍 Starting project analysis: ${name}`);
            const zipBuffer = Buffer.from(buffer);
            const projectData = await codeAnalyzer.analyzeProject(zipBuffer, name);
            
            console.log(`✅ Project analysis completed: ${name}`);
            return { success: true, project: projectData };
        } catch (error) {
            console.error('❌ Project analysis failed:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-analyzed-projects', async (event) => {
        try {
            const projects = Array.from(codeAnalyzer.projects.values());
            return { success: true, projects };
        } catch (error) {
            console.error('Error getting analyzed projects:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('activate-project', async (event, projectName) => {
        try {
            const project = codeAnalyzer.projects.get(projectName);
            if (!project) {
                throw new Error(`Project ${projectName} not found`);
            }
            
            activeProject = project;
            console.log(`🎯 Activated project for Q&A: ${projectName}`);
            
            return { success: true, project: activeProject };
        } catch (error) {
            console.error('Error activating project:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('deactivate-project', async (event) => {
        try {
            const previousProject = activeProject?.name || null;
            activeProject = null;
            console.log(`🔄 Deactivated project: ${previousProject}`);
            
            return { success: true };
        } catch (error) {
            console.error('Error deactivating project:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-project', async (event, projectName) => {
        try {
            if (activeProject?.name === projectName) {
                activeProject = null;
            }
            
            codeAnalyzer.projects.delete(projectName);
            codeAnalyzer.codeIndices.delete(projectName);
            
            console.log(`🗑️ Deleted project: ${projectName}`);
            return { success: true };
        } catch (error) {
            console.error('Error deleting project:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('answer-code-question', async (event, { projectName, question }) => {
        try {
            if (!projectName) {
                projectName = activeProject?.name;
            }
            
            if (!projectName) {
                throw new Error('No project activated for code Q&A');
            }
            
            const answer = await codeAnalyzer.answerCodeQuestion(projectName, question);
            return { success: true, answer };
        } catch (error) {
            console.error('Error answering code question:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-active-project', async (event) => {
        try {
            return { 
                success: true, 
                project: activeProject,
                isActive: !!activeProject 
            };
        } catch (error) {
            console.error('Error getting active project:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    sendReconnectionContext,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    setupGeminiIpcHandlers,
    attemptReconnection,
    formatSpeakerResults,
};
