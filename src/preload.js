const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Gemini Session Management
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    
    // Core Gemini functionality
    initializeGemini: (apiKey, customPrompt, profile, language) => 
        ipcRenderer.invoke('initialize-gemini', apiKey, customPrompt, profile, language),
    
    sendAudioContent: (data) => 
        ipcRenderer.invoke('send-audio-content', data),
    
    sendMicAudioContent: (data) => 
        ipcRenderer.invoke('send-mic-audio-content', data),
    
    sendImageContent: (data) => 
        ipcRenderer.invoke('send-image-content', data),
    
    sendTextMessage: (text) => 
        ipcRenderer.invoke('send-text-message', text),
    
    startMacOSAudio: () => 
        ipcRenderer.invoke('start-macos-audio'),
    
    stopMacOSAudio: () => 
        ipcRenderer.invoke('stop-macos-audio'),
    
    closeSession: () => 
        ipcRenderer.invoke('close-session'),
    
    getCurrentSession: () => 
        ipcRenderer.invoke('get-current-session'),
    
    startNewSession: () => 
        ipcRenderer.invoke('start-new-session'),
    
    updateGoogleSearchSetting: (enabled) => 
        ipcRenderer.invoke('update-google-search-setting', enabled),
    
    // Project Code Analysis functionality
    analyzeProject: (data) => 
        ipcRenderer.invoke('analyze-project', data),
    
    getAnalyzedProjects: () => 
        ipcRenderer.invoke('get-analyzed-projects'),
    
    activateProject: (projectName) => 
        ipcRenderer.invoke('activate-project', projectName),
    
    deactivateProject: () => 
        ipcRenderer.invoke('deactivate-project'),
    
    deleteProject: (projectName) => 
        ipcRenderer.invoke('delete-project', projectName),
    
    answerCodeQuestion: (data) => 
        ipcRenderer.invoke('answer-code-question', data),
    
    getActiveProject: () => 
        ipcRenderer.invoke('get-active-project'),
    
    // Event listeners
    on: (channel, func) => {
        const validChannels = [
            'update-response',
            'session-error', 
            'audio-capture-started',
            'audio-capture-stopped',
            'session-ended',
            'project-activated',
            'project-deactivated'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, func);
        }
    },
    
    removeListener: (channel, func) => {
        ipcRenderer.removeListener(channel, func);
    }
});

// Also expose Node.js require for backward compatibility (if needed)
if (process.contextIsolated) {
    try {
        window.require = require;
    } catch (error) {
        console.log('Could not expose require in context isolated environment');
    }
}
