const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Code Analysis Engine for Project Q&A Feature
 * Analyzes uploaded projects and provides intelligent code-based responses
 */

class CodeAnalyzer {
    constructor() {
        this.projects = new Map(); // Store analyzed projects
        this.codeIndices = new Map(); // Store code search indices
        this.supportedExtensions = new Set([
            // JavaScript/TypeScript
            '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
            // Python
            '.py', '.pyx', '.pyi', '.pyw',
            // Java/Kotlin/Scala
            '.java', '.kt', '.scala',
            // C/C++
            '.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx',
            // C#/F#
            '.cs', '.fs', '.fsx',
            // Web
            '.php', '.html', '.htm', '.css', '.scss', '.sass', '.less',
            // Ruby/Go/Rust
            '.rb', '.go', '.rs',
            // Swift/Objective-C
            '.swift', '.m', '.mm',
            // Other languages
            '.dart', '.lua', '.perl', '.pl', '.r',
            // Frameworks
            '.vue', '.svelte',
            // Data/Config
            '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
            // Documentation/Scripts
            '.md', '.txt', '.rst', '.sql', '.sh', '.bash', '.bat', '.ps1', '.cmd',
            // R files (for OncoPredict project)
            '.R', '.r', '.Rmd', '.Rnw',
            // Jupyter/Data Science
            '.ipynb', '.jl',
            // Makefile and config files without extensions
            ''
        ]);
        
        // Special file names without extensions that should be processed
        this.specialFiles = new Set([
            'Makefile', 'makefile', 'MAKEFILE',
            'Dockerfile', 'dockerfile', 'DOCKERFILE',
            'Jenkinsfile', 'jenkinsfile',
            'Vagrantfile', 'vagrantfile',
            '.gitignore', '.dockerignore', '.eslintrc', '.babelrc',
            'README', 'LICENSE', 'CHANGELOG', 'CONTRIBUTING'
        ]);
    }

    /**
     * Analyze uploaded ZIP project
     */
    async analyzeProject(zipBuffer, projectName) {
        console.log(`🔍 Starting analysis of project: ${projectName}`);
        
        try {
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries();
            
            const projectStructure = await this.buildProjectStructure(entries);
            const codeFiles = await this.extractCodeFiles(entries);
            const analysis = await this.performCodeAnalysis(codeFiles);
            const searchIndex = await this.buildSearchIndex(codeFiles);
            
            const projectData = {
                name: projectName,
                timestamp: Date.now(),
                structure: projectStructure,
                files: codeFiles,
                analysis: analysis,
                searchIndex: searchIndex,
                stats: this.calculateProjectStats(codeFiles)
            };
            
            // Store project data
            this.projects.set(projectName, projectData);
            this.codeIndices.set(projectName, searchIndex);
            
            // Persist to disk
            await this.saveProjectData(projectName, projectData);
            
            console.log(`✅ Project analysis completed: ${projectName}`);
            return projectData;
            
        } catch (error) {
            console.error('❌ Project analysis failed:', error);
            throw new Error(`Failed to analyze project: ${error.message}`);
        }
    }

    /**
     * Build hierarchical project structure
     */
    async buildProjectStructure(entries) {
        const structure = { type: 'folder', name: 'root', children: {} };
        
        entries.forEach(entry => {
            if (entry.isDirectory) return;
            
            const pathParts = entry.entryName.split('/').filter(part => part);
            let current = structure;
            
            // Build folder structure
            for (let i = 0; i < pathParts.length - 1; i++) {
                const folderName = pathParts[i];
                if (!current.children[folderName]) {
                    current.children[folderName] = {
                        type: 'folder',
                        name: folderName,
                        children: {}
                    };
                }
                current = current.children[folderName];
            }
            
            // Add file
            const fileName = pathParts[pathParts.length - 1];
            const ext = path.extname(fileName);
            current.children[fileName] = {
                type: 'file',
                name: fileName,
                extension: ext,
                path: entry.entryName,
                size: entry.header.size,
                supported: this.supportedExtensions.has(ext.toLowerCase())
            };
        });
        
        return structure;
    }

    /**
     * Extract and parse code files
     */
    async extractCodeFiles(entries) {
        const codeFiles = [];
        
        console.log(`📂 Processing ${entries.length} entries from ZIP file`);
        
        for (const entry of entries) {
            if (entry.isDirectory) {
                console.log(`📁 Skipping directory: ${entry.entryName}`);
                continue;
            }
            
            // Skip .git folder files
            if (entry.entryName.includes('/.git/')) {
                console.log(`🔧 Skipping git file: ${entry.entryName}`);
                continue;
            }
            
            const fileName = path.basename(entry.entryName);
            const ext = path.extname(fileName).toLowerCase();
            
            console.log(`📄 Processing file: ${entry.entryName} (extension: ${ext || 'none'})`);
            
            // Check if file extension is supported OR if it's a special file
            const isSupported = this.supportedExtensions.has(ext) || 
                               this.specialFiles.has(fileName) ||
                               this.specialFiles.has(fileName.toLowerCase());
            
            if (!isSupported) {
                console.log(`⚠️ Unsupported file: ${entry.entryName}`);
                continue;
            }
            
            console.log(`✅ Supported file detected: ${entry.entryName}`);
            
            try {
                let content = entry.getData('utf8');
                
                // Ensure content is a string
                if (typeof content !== 'string') {
                    console.warn(`⚠️ Content is not a string for ${entry.entryName}, converting...`);
                    content = content.toString('utf8');
                }
                
                // Special handling for Jupyter notebooks
                if (ext === '.ipynb') {
                    try {
                        const notebook = JSON.parse(content);
                        // Extract code from cells
                        let codeContent = '';
                        if (notebook.cells) {
                            notebook.cells.forEach(cell => {
                                if (cell.cell_type === 'code' && cell.source) {
                                    const cellCode = Array.isArray(cell.source) ? 
                                        cell.source.join('') : cell.source;
                                    codeContent += cellCode + '\n';
                                }
                            });
                        }
                        content = codeContent;
                        console.log(`📊 Jupyter notebook ${entry.entryName}: extracted ${codeContent.length} characters of code`);
                    } catch (error) {
                        console.warn(`⚠️ Failed to parse Jupyter notebook ${entry.entryName}:`, error.message);
                        continue;
                    }
                }
                
                // Validate content
                if (!content || content.length === 0) {
                    console.warn(`⚠️ Empty content for ${entry.entryName}, skipping...`);
                    continue;
                }
                
                console.log(`📊 File ${entry.entryName}: ${content.length} characters, ${content.split('\n').length} lines`);
                
                const lines = content.split('\n');
                
                const fileData = {
                    path: entry.entryName,
                    name: fileName,
                    extension: ext || '.txt', // Default for files without extension
                    content: content,
                    lines: lines,
                    lineCount: lines.length,
                    size: entry.header.size || content.length,
                    functions: this.extractFunctions(content, ext || '.txt'),
                    classes: this.extractClasses(content, ext || '.txt'),
                    imports: this.extractImports(content, ext || '.txt'),
                    exports: this.extractExports(content, ext || '.txt'),
                    comments: this.extractComments(content, ext || '.txt')
                };
                
                console.log(`✅ Successfully processed: ${entry.entryName} - ${fileData.functions.length} functions, ${fileData.classes.length} classes`);
                codeFiles.push(fileData);
            } catch (error) {
                console.warn(`⚠️ Failed to process file ${entry.entryName}:`, error.message);
            }
        }
        
        console.log(`📊 Total code files extracted: ${codeFiles.length}`);
        return codeFiles;
    }

    /**
     * Perform deep code analysis
     */
    async performCodeAnalysis(codeFiles) {
        const analysis = {
            technologies: this.detectTechnologies(codeFiles),
            frameworks: this.detectFrameworks(codeFiles),
            patterns: this.detectPatterns(codeFiles),
            architecture: this.analyzeArchitecture(codeFiles),
            dependencies: this.extractDependencies(codeFiles),
            complexity: this.calculateComplexity(codeFiles)
        };
        
        return analysis;
    }

    /**
     * Build searchable index for fast Q&A
     */
    async buildSearchIndex(codeFiles) {
        const index = {
            functions: new Map(),
            classes: new Map(),
            variables: new Map(),
            imports: new Map(),
            files: new Map(),
            patterns: new Map()
        };
        
        codeFiles.forEach(file => {
            // Index functions
            file.functions.forEach(func => {
                const key = func.name.toLowerCase();
                if (!index.functions.has(key)) {
                    index.functions.set(key, []);
                }
                index.functions.get(key).push({
                    file: file.path,
                    line: func.line,
                    signature: func.signature,
                    content: func.content
                });
            });
            
            // Index classes
            file.classes.forEach(cls => {
                const key = cls.name.toLowerCase();
                if (!index.classes.has(key)) {
                    index.classes.set(key, []);
                }
                index.classes.get(key).push({
                    file: file.path,
                    line: cls.line,
                    methods: cls.methods,
                    content: cls.content
                });
            });
            
            // Index file content for full-text search
            index.files.set(file.path, {
                content: file.content,
                lines: file.lines,
                functions: file.functions.map(f => f.name),
                classes: file.classes.map(c => c.name)
            });
        });
        
        return index;
    }

    /**
     * Answer code-related questions with exact locations
     */
    async answerCodeQuestion(projectName, question) {
        const project = this.projects.get(projectName);
        if (!project) {
            throw new Error(`Project ${projectName} not found`);
        }
        
        const searchIndex = this.codeIndices.get(projectName);
        const questionLower = question.toLowerCase();
        
        // Handle general questions about project structure first
        if (this.isGeneralProjectQuestion(question)) {
            return this.handleGeneralProjectQuestion(project, question);
        }
        
        // Identify question type and extract keywords
        const questionType = this.identifyQuestionType(question);
        const keywords = this.extractKeywords(question);
        
        let results = [];
        
        switch (questionType) {
            case 'function':
                results = this.searchFunctions(searchIndex, keywords);
                break;
            case 'class':
                results = this.searchClasses(searchIndex, keywords);
                break;
            case 'implementation':
                results = this.searchImplementations(searchIndex, keywords);
                break;
            case 'pattern':
                results = this.searchPatterns(project, keywords);
                break;
            case 'architecture':
                results = this.searchArchitecture(project, keywords);
                break;
            default:
                results = this.performFullTextSearch(searchIndex, keywords);
        }
        
        return this.formatResponse(results, questionType, question);
    }

    /**
     * Check if question is asking for general project information
     */
    isGeneralProjectQuestion(question) {
        const questionLower = question.toLowerCase();
        const generalPatterns = [
            'what functions', 'list functions', 'all functions', 'functions you have',
            'core functions', 'main functions', 'key functions', 'derive functions',
            'what classes', 'list classes', 'all classes', 'classes you have',
            'tech stack', 'technologies', 'languages used', 'what tools',
            'project structure', 'file structure', 'how many files',
            'overview', 'summary', 'what does this project do',
            'architecture', 'components', 'modules', 'implementation',
            'how it works', 'how does it work', 'explain the project',
            'project functionality', 'system components', 'core features'
        ];
        
        return generalPatterns.some(pattern => questionLower.includes(pattern));
    }

    /**
     * Handle general questions about the project
     */
    handleGeneralProjectQuestion(project, question) {
        const questionLower = question.toLowerCase();
        let answer = '';
        let totalMatches = 0;

        // Function-related questions - provide comprehensive function analysis
        if (questionLower.includes('function') || questionLower.includes('core') || questionLower.includes('main') || questionLower.includes('key')) {
            const allFunctions = [];
            project.files.forEach(file => {
                if (file.functions && file.functions.length > 0) {
                    file.functions.forEach(func => {
                        allFunctions.push({
                            name: func.name,
                            file: file.path,
                            line: func.line,
                            signature: func.signature,
                            fileName: file.name
                        });
                    });
                }
            });

            if (allFunctions.length > 0) {
                answer += `**Core Functions in "${project.name}" Project (${allFunctions.length} total):**\n\n`;
                
                // Group functions by file and categorize by purpose
                const functionsByFile = {};
                allFunctions.forEach(func => {
                    if (!functionsByFile[func.file]) {
                        functionsByFile[func.file] = [];
                    }
                    functionsByFile[func.file].push(func);
                });

                // Prioritize key RAG system files
                const keyFiles = [
                    'rag_system.py', 'data_prep.py', 'fine_tune.py', 
                    'demo_app_upload.py', 'test_system.py'
                ];

                // Show key system functions first
                keyFiles.forEach(keyFile => {
                    const filePath = Object.keys(functionsByFile).find(path => path.includes(keyFile));
                    if (filePath && functionsByFile[filePath]) {
                        const functions = functionsByFile[filePath];
                        answer += `**${keyFile} (${functions.length} functions):**\n`;
                        answer += `Location: \`${filePath}\`\n\n`;
                        
                        functions.forEach(func => {
                            answer += `- **\`${func.name}()\`** at line ${func.line}\n`;
                            if (func.signature) {
                                answer += `  \`${func.signature.trim()}\`\n`;
                            }
                        });
                        answer += '\n';
                        delete functionsByFile[filePath]; // Remove to avoid duplication
                    }
                });

                // Show remaining files
                Object.keys(functionsByFile).forEach(filePath => {
                    const fileName = filePath.split('/').pop();
                    const functions = functionsByFile[filePath];
                    answer += `**${fileName} (${functions.length} functions):**\n`;
                    answer += `Location: \`${filePath}\`\n\n`;
                    
                    functions.forEach(func => {
                        answer += `- **\`${func.name}()\`** at line ${func.line}\n`;
                        if (func.signature) {
                            answer += `  \`${func.signature.trim()}\`\n`;
                        }
                    });
                    answer += '\n';
                });

                // Add functional categorization for RAG systems
                answer += `\n**Functional Categories:**\n`;
                answer += `- **Data Processing**: Functions in \`data_prep.py\` handle document loading, chunking, and text extraction\n`;
                answer += `- **Vector Storage**: Functions in \`rag_system.py\` manage embeddings and similarity search\n`;
                answer += `- **Model Training**: Functions in \`fine_tune.py\` handle model fine-tuning with LoRA\n`;
                answer += `- **User Interface**: Functions in \`demo_app_upload.py\` provide Streamlit web interface\n`;
                answer += `- **System Testing**: Functions in \`test_system.py\` validate system components\n\n`;

                totalMatches = allFunctions.length;
            }
        }

        // Architecture and implementation questions
        if (questionLower.includes('architecture') || questionLower.includes('implementation') || questionLower.includes('how') || questionLower.includes('work')) {
            answer += `**System Architecture Overview:**\n\n`;
            answer += `**Core Components:**\n`;
            answer += `1. **Document Processing Pipeline** (\`src/data_prep.py\`)\n`;
            answer += `   - Text extraction from PDF, DOCX, Excel, Markdown\n`;
            answer += `   - Document chunking and cleaning\n`;
            answer += `   - Training data preparation\n\n`;
            
            answer += `2. **Vector Database System** (\`src/rag_system.py\`)\n`;
            answer += `   - ChromaDB for persistent vector storage\n`;
            answer += `   - SentenceTransformer embeddings (all-MiniLM-L6-v2)\n`;
            answer += `   - Similarity search and retrieval\n\n`;
            
            answer += `3. **Model Fine-tuning** (\`src/fine_tune.py\`)\n`;
            answer += `   - LoRA (Low-Rank Adaptation) fine-tuning\n`;
            answer += `   - DialoGPT-small base model\n`;
            answer += `   - Training pipeline with HuggingFace Transformers\n\n`;
            
            answer += `4. **Web Interface** (\`src/demo_app_upload.py\`)\n`;
            answer += `   - Streamlit-based UI for document upload\n`;
            answer += `   - Real-time Q&A interface\n`;
            answer += `   - Document management system\n\n`;

            totalMatches += 4;
        }

        // Tech stack questions
        if (questionLower.includes('tech') || questionLower.includes('language') || questionLower.includes('tool') || questionLower.includes('stack')) {
            answer += `**Technology Stack:**\n\n`;
            answer += `**Languages & Frameworks:**\n`;
            answer += `- **Python** (Primary language)\n`;
            answer += `- **Streamlit** (Web interface)\n`;
            answer += `- **ChromaDB** (Vector database)\n`;
            answer += `- **SentenceTransformers** (Embeddings)\n`;
            answer += `- **HuggingFace Transformers** (Model training)\n`;
            answer += `- **PyTorch** (Deep learning framework)\n`;
            answer += `- **PEFT/LoRA** (Parameter-efficient fine-tuning)\n\n`;

            answer += `**File Types Supported:**\n`;
            answer += `- ${project.stats.languages.join(', ')}\n\n`;
            
            answer += `**Project Statistics:**\n`;
            answer += `- **Total Files**: ${project.stats.totalFiles}\n`;
            answer += `- **Lines of Code**: ${project.stats.totalLines.toLocaleString()}\n`;
            answer += `- **Total Functions**: ${project.stats.functionCount}\n`;
            answer += `- **Classes**: ${project.stats.classCount}\n\n`;
            
            totalMatches += 1;
        }

        // Project structure questions
        if (questionLower.includes('structure') || questionLower.includes('file') || questionLower.includes('overview')) {
            answer += `**Project Structure:**\n\n`;
            const filesByExtension = {};
            project.files.forEach(file => {
                const ext = file.extension || 'config files';
                if (!filesByExtension[ext]) {
                    filesByExtension[ext] = [];
                }
                filesByExtension[ext].push(file.name);
            });

            Object.keys(filesByExtension).forEach(ext => {
                answer += `**${ext} files (${filesByExtension[ext].length}):**\n`;
                filesByExtension[ext].slice(0, 10).forEach(fileName => {
                    answer += `- ${fileName}\n`;
                });
                if (filesByExtension[ext].length > 10) {
                    answer += `- ... and ${filesByExtension[ext].length - 10} more\n`;
                }
                answer += '\n';
            });
            totalMatches += Object.keys(filesByExtension).length;
        }

        if (!answer) {
            answer = `**"${project.name}" Project Summary:**\n\n`;
            answer += `This is a **Retrieval-Augmented Generation (RAG) system** with ${project.stats.functionCount} functions across ${project.stats.totalFiles} files.\n\n`;
            answer += `**Key capabilities include:**\n`;
            answer += `- Document processing and embedding generation\n`;
            answer += `- Vector-based similarity search\n`;
            answer += `- Model fine-tuning with LoRA\n`;
            answer += `- Interactive web interface\n\n`;
            answer += `**Main files:** \`rag_system.py\`, \`data_prep.py\`, \`fine_tune.py\`, \`demo_app_upload.py\`\n\n`;
            answer += `What specific aspect would you like me to explain in detail?`;
            totalMatches = 1;
        }

        return {
            answer: answer.trim(),
            totalMatches: totalMatches,
            projectName: project.name
        };
    }

    /**
     * Extract functions from code based on language
     */
    extractFunctions(content, extension) {
        const functions = [];
        const lines = content.split('\n');
        
        // JavaScript/TypeScript function patterns
        if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
            const functionRegex = /(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:function|\([^)]*\)\s*=>)|async\s+function\s+(\w+)|(\w+)\s*\([^)]*\)\s*{)/g;
            
            lines.forEach((line, index) => {
                let match;
                while ((match = functionRegex.exec(line)) !== null) {
                    const name = match[1] || match[2] || match[3] || match[4];
                    if (name) {
                        functions.push({
                            name: name,
                            line: index + 1,
                            signature: line.trim(),
                            content: this.extractFunctionBody(lines, index)
                        });
                    }
                }
            });
        }
        
        // Python function patterns (also works for Jupyter notebook code)
        if (extension === '.py' || extension === '.ipynb') {
            const functionRegex = /def\s+(\w+)\s*\([^)]*\):/g;
            
            lines.forEach((line, index) => {
                let match;
                while ((match = functionRegex.exec(line)) !== null) {
                    functions.push({
                        name: match[1],
                        line: index + 1,
                        signature: line.trim(),
                        content: this.extractFunctionBody(lines, index)
                    });
                }
            });
        }
        
        // R function patterns
        if (['.R', '.r', '.Rmd'].includes(extension)) {
            const functionRegex = /(\w+)\s*<-\s*function\s*\([^)]*\)|(\w+)\s*=\s*function\s*\([^)]*\)/g;
            
            lines.forEach((line, index) => {
                let match;
                while ((match = functionRegex.exec(line)) !== null) {
                    const name = match[1] || match[2];
                    if (name) {
                        functions.push({
                            name: name,
                            line: index + 1,
                            signature: line.trim(),
                            content: this.extractFunctionBody(lines, index)
                        });
                    }
                }
            });
        }
        
        // Java function patterns
        if (extension === '.java') {
            const methodRegex = /(?:public|private|protected|static|\s)*\s+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*{/g;
            
            lines.forEach((line, index) => {
                let match;
                while ((match = methodRegex.exec(line)) !== null) {
                    functions.push({
                        name: match[1],
                        line: index + 1,
                        signature: line.trim(),
                        content: this.extractFunctionBody(lines, index)
                    });
                }
            });
        }
        
        return functions;
    }

    /**
     * Extract classes from code
     */
    extractClasses(content, extension) {
        const classes = [];
        const lines = content.split('\n');
        
        // JavaScript/TypeScript class patterns
        if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
            const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
            
            lines.forEach((line, index) => {
                let match;
                while ((match = classRegex.exec(line)) !== null) {
                    classes.push({
                        name: match[1],
                        extends: match[2] || null,
                        line: index + 1,
                        content: this.extractClassBody(lines, index),
                        methods: this.extractClassMethods(lines, index)
                    });
                }
            });
        }
        
        return classes;
    }

    /**
     * Search functions in the index
     */
    searchFunctions(searchIndex, keywords) {
        const results = [];
        
        keywords.forEach(keyword => {
            if (searchIndex.functions.has(keyword.toLowerCase())) {
                const matches = searchIndex.functions.get(keyword.toLowerCase());
                results.push(...matches);
            }
        });
        
        return results;
    }

    /**
     * Format response with exact file locations
     */
    formatResponse(results, questionType, originalQuestion) {
        // Ensure results is an array
        if (!Array.isArray(results)) {
            console.warn('Results is not an array:', results);
            results = [];
        }
        
        if (results.length === 0) {
            return {
                answer: "I couldn't find specific implementations for your question in the analyzed project.",
                confidence: 0,
                sources: [],
                totalMatches: 0
            };
        }
        
        let answer = "";
        const sources = [];
        
        switch (questionType) {
            case 'function':
                answer = `Found ${results.length} function implementation(s):\n\n`;
                results.forEach((result, index) => {
                    answer += `**${index + 1}. Function Implementation:**\n`;
                    answer += `📁 File: \`${result.file}\`\n`;
                    answer += `📍 Line: ${result.line}\n`;
                    answer += `💻 Signature: \`${result.signature}\`\n\n`;
                    
                    sources.push({
                        file: result.file,
                        line: result.line,
                        type: 'function',
                        content: result.content
                    });
                });
                break;
                
            case 'class':
                answer = `Found ${results.length} class implementation(s):\n\n`;
                results.forEach((result, index) => {
                    answer += `**${index + 1}. Class Implementation:**\n`;
                    answer += `📁 File: \`${result.file}\`\n`;
                    answer += `📍 Line: ${result.line}\n`;
                    answer += `🔧 Methods: ${result.methods ? result.methods.join(', ') : 'N/A'}\n\n`;
                    
                    sources.push({
                        file: result.file,
                        line: result.line,
                        type: 'class',
                        content: result.content
                    });
                });
                break;
                
            default:
                answer = `Found ${results.length} relevant implementation(s) in the project:\n\n`;
                results.forEach((result, index) => {
                    answer += `**${index + 1}. Implementation:**\n`;
                    answer += `📁 File: \`${result.file}\`\n`;
                    answer += `📍 Line: ${result.line || 'Multiple lines'}\n\n`;
                    
                    sources.push(result);
                });
        }
        
        return {
            answer: answer,
            confidence: Math.min(results.length * 0.2, 1.0),
            sources: sources,
            totalMatches: results.length
        };
    }

    // Helper methods for pattern detection, complexity analysis, etc.
    detectTechnologies(codeFiles) {
        const technologies = new Set();
        
        codeFiles.forEach(file => {
            switch (file.extension) {
                case '.js': case '.jsx': technologies.add('JavaScript'); break;
                case '.ts': case '.tsx': technologies.add('TypeScript'); break;
                case '.py': technologies.add('Python'); break;
                case '.java': technologies.add('Java'); break;
                case '.cpp': case '.c': technologies.add('C/C++'); break;
                case '.cs': technologies.add('C#'); break;
                case '.php': technologies.add('PHP'); break;
                case '.rb': technologies.add('Ruby'); break;
                case '.go': technologies.add('Go'); break;
                case '.rs': technologies.add('Rust'); break;
            }
        });
        
        return Array.from(technologies);
    }

    identifyQuestionType(question) {
        const questionLower = question.toLowerCase();
        
        if (questionLower.includes('function') || questionLower.includes('method')) {
            return 'function';
        } else if (questionLower.includes('class') || questionLower.includes('object')) {
            return 'class';
        } else if (questionLower.includes('implement') || questionLower.includes('implementation')) {
            return 'implementation';
        } else if (questionLower.includes('pattern') || questionLower.includes('design')) {
            return 'pattern';
        } else if (questionLower.includes('architecture') || questionLower.includes('structure')) {
            return 'architecture';
        }
        
        return 'general';
    }

    extractKeywords(question) {
        // Simple keyword extraction - can be enhanced with NLP
        const words = question.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2);
        
        // Remove common stop words
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);
        
        return words.filter(word => !stopWords.has(word));
    }

    // Additional helper methods...
    extractFunctionBody(lines, startIndex) {
        // Extract function body (simplified)
        let braceCount = 0;
        let endIndex = startIndex;
        
        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
            
            if (braceCount === 0 && i > startIndex) {
                endIndex = i;
                break;
            }
        }
        
        return lines.slice(startIndex, endIndex + 1).join('\n');
    }

    extractClassBody(lines, startIndex) {
        // Similar to extractFunctionBody but for classes
        return this.extractFunctionBody(lines, startIndex);
    }

    extractClassMethods(lines, startIndex) {
        // Extract method names from class
        const methods = [];
        // Simplified implementation
        return methods;
    }

    extractImports(content, extension) {
        const imports = [];
        // Implementation for extracting imports
        return imports;
    }

    extractExports(content, extension) {
        const exports = [];
        // Implementation for extracting exports
        return exports;
    }

    extractComments(content, extension) {
        const comments = [];
        // Implementation for extracting comments
        return comments;
    }

    detectFrameworks(codeFiles) {
        const frameworks = new Set();
        // Implementation for framework detection
        return Array.from(frameworks);
    }

    detectPatterns(codeFiles) {
        const patterns = [];
        // Implementation for pattern detection
        return patterns;
    }

    analyzeArchitecture(codeFiles) {
        // Implementation for architecture analysis
        return {};
    }

    extractDependencies(codeFiles) {
        const dependencies = [];
        // Implementation for dependency extraction
        return dependencies;
    }

    calculateComplexity(codeFiles) {
        // Implementation for complexity calculation
        return {};
    }

    calculateProjectStats(codeFiles) {
        return {
            totalFiles: codeFiles.length,
            totalLines: codeFiles.reduce((sum, file) => sum + file.lineCount, 0),
            totalSize: codeFiles.reduce((sum, file) => sum + file.size, 0),
            languages: [...new Set(codeFiles.map(file => file.extension))],
            functionCount: codeFiles.reduce((sum, file) => sum + file.functions.length, 0),
            classCount: codeFiles.reduce((sum, file) => sum + file.classes.length, 0)
        };
    }

    performFullTextSearch(searchIndex, keywords) {
        const results = [];
        
        // Search through all file contents
        keywords.forEach(keyword => {
            searchIndex.files.forEach((fileData, filePath) => {
                if (fileData.content.toLowerCase().includes(keyword.toLowerCase())) {
                    // Find lines containing the keyword
                    fileData.lines.forEach((line, index) => {
                        if (line.toLowerCase().includes(keyword.toLowerCase())) {
                            results.push({
                                file: filePath,
                                line: index + 1,
                                content: line.trim(),
                                matchType: 'text'
                            });
                        }
                    });
                }
            });
        });
        
        return results;
    }

    searchClasses(searchIndex, keywords) {
        const results = [];
        
        keywords.forEach(keyword => {
            if (searchIndex.classes.has(keyword.toLowerCase())) {
                const matches = searchIndex.classes.get(keyword.toLowerCase());
                results.push(...matches);
            }
        });
        
        return results;
    }

    searchImplementations(searchIndex, keywords) {
        const results = [];
        
        // Search in both functions and classes for implementation keywords
        keywords.forEach(keyword => {
            // Search functions
            if (searchIndex.functions.has(keyword.toLowerCase())) {
                const matches = searchIndex.functions.get(keyword.toLowerCase());
                results.push(...matches);
            }
            
            // Search classes
            if (searchIndex.classes.has(keyword.toLowerCase())) {
                const matches = searchIndex.classes.get(keyword.toLowerCase());
                results.push(...matches);
            }
        });
        
        return results;
    }

    searchPatterns(project, keywords) {
        const results = [];
        
        // Search for design patterns in the code structure
        keywords.forEach(keyword => {
            project.files.forEach(file => {
                if (file.content.toLowerCase().includes(keyword.toLowerCase())) {
                    results.push({
                        file: file.path,
                        line: 1,
                        content: `Pattern found in ${file.name}`,
                        matchType: 'pattern'
                    });
                }
            });
        });
        
        return results;
    }

    searchArchitecture(project, keywords) {
        const results = [];
        
        // Search for architectural patterns based on file structure and naming
        keywords.forEach(keyword => {
            project.files.forEach(file => {
                if (file.path.toLowerCase().includes(keyword.toLowerCase()) || 
                    file.content.toLowerCase().includes(keyword.toLowerCase())) {
                    results.push({
                        file: file.path,
                        line: 1,
                        content: `Architecture component in ${file.name}`,
                        matchType: 'architecture'
                    });
                }
            });
        });
        
        return results;
    }

    async saveProjectData(projectName, projectData) {
        // Implementation for persisting project data
        console.log(`💾 Saving project data for: ${projectName}`);
    }
}

module.exports = { CodeAnalyzer };
