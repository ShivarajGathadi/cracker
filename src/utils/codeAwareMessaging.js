// Enhanced message handler for code-aware responses
async function enhanceMessageWithCodeContext(message, geminiSessionRef) {
    try {
        // Check if there's an active project
        const activeProjectResult = await window.electronAPI.invoke('get-active-project');
        
        if (!activeProjectResult.success || !activeProjectResult.isActive) {
            // No active project, send message normally
            return await window.electronAPI.invoke('send-text-message', message);
        }

        const activeProject = activeProjectResult.project;
        
        // Check if the message seems to be asking about code/implementation
        const codeKeywords = [
            'implementation', 'implement', 'code', 'function', 'class', 'method',
            'algorithm', 'logic', 'structure', 'architecture', 'pattern',
            'where is', 'how do you', 'how does', 'what does', 'show me',
            'find', 'locate', 'file', 'folder', 'directory', 'line',
            'authentication', 'validation', 'error handling', 'database',
            'api', 'endpoint', 'route', 'component', 'service', 'utility'
        ];
        
        const messageHasCodeKeywords = codeKeywords.some(keyword => 
            message.toLowerCase().includes(keyword)
        );
        
        if (messageHasCodeKeywords) {
            console.log('🔍 Code-related question detected, searching project...');
            
            // Try to get a specific code answer first
            const codeAnswerResult = await window.electronAPI.invoke('answer-code-question', {
                projectName: activeProject.name,
                question: message
            });
            
            if (codeAnswerResult.success && codeAnswerResult.answer.totalMatches > 0) {
                console.log('✅ Found specific code implementations');
                
                // Enhance the original message with code context
                const enhancedMessage = `${message}

**IMPORTANT: I found specific implementations in my analyzed project "${activeProject.name}". Here are the exact locations:**

${codeAnswerResult.answer.answer}

Please provide a response based on these specific implementations and file locations.`;
                
                return await window.electronAPI.invoke('send-text-message', enhancedMessage);
            }
        }
        
        // If no specific code answer found, send the original message with project context
        const contextEnhancedMessage = `${message}

**Context: I'm discussing my project "${activeProject.name}" which uses ${activeProject.analysis.technologies.join(', ')}. It has ${activeProject.stats.totalFiles} files and ${activeProject.stats.functionCount} functions.**`;
        
        return await window.electronAPI.invoke('send-text-message', contextEnhancedMessage);
        
    } catch (error) {
        console.error('Error enhancing message with code context:', error);
        // Fallback to normal message sending
        return await window.electronAPI.invoke('send-text-message', message);
    }
}

// Export for use in other components
window.enhanceMessageWithCodeContext = enhanceMessageWithCodeContext;
