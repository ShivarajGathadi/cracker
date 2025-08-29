import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class ProjectAnalysisView extends LitElement {
    static styles = css`
        * {
            font-family: 'Inter', sans-serif;
            cursor: default;
            user-select: none;
        }

        .container {
            padding: 20px;
            height: 100%;
            overflow-y: auto;
        }

        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--button-border);
        }

        .header h2 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: var(--text-color);
        }

        .upload-section {
            background: var(--input-background);
            border: 2px dashed var(--button-border);
            border-radius: 12px;
            padding: 40px 20px;
            text-align: center;
            margin-bottom: 24px;
            transition: all 0.3s ease;
        }

        .upload-section.dragover {
            border-color: var(--focus-border-color);
            background: var(--input-focus-background);
        }

        .upload-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.6;
        }

        .upload-text {
            color: var(--text-color);
            margin-bottom: 16px;
        }

        .upload-button {
            background: var(--start-button-background);
            color: var(--start-button-color);
            border: 1px solid var(--start-button-border);
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .upload-button:hover {
            background: var(--start-button-hover-background);
            border-color: var(--start-button-hover-border);
        }

        .file-input {
            display: none;
        }

        .projects-list {
            margin-top: 24px;
        }

        .projects-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .projects-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-color);
        }

        .project-item {
            background: var(--card-background);
            border: 1px solid var(--button-border);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            transition: all 0.2s ease;
        }

        .project-item:hover {
            border-color: var(--focus-border-color);
            background: var(--input-focus-background);
        }

        .project-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .project-name {
            font-weight: 600;
            color: var(--text-color);
        }

        .project-date {
            font-size: 12px;
            color: var(--placeholder-color);
        }

        .project-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
            margin-bottom: 12px;
        }

        .stat-item {
            text-align: center;
            padding: 8px;
            background: var(--input-background);
            border-radius: 6px;
        }

        .stat-number {
            font-weight: 600;
            color: var(--text-color);
            display: block;
        }

        .stat-label {
            font-size: 11px;
            color: var(--placeholder-color);
            text-transform: uppercase;
        }

        .project-actions {
            display: flex;
            gap: 8px;
        }

        .action-button {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--button-border);
            background: var(--input-background);
            color: var(--text-color);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .action-button:hover {
            background: var(--input-focus-background);
            border-color: var(--focus-border-color);
        }

        .action-button.primary {
            background: var(--start-button-background);
            color: var(--start-button-color);
            border-color: var(--start-button-border);
        }

        .action-button.primary:hover {
            background: var(--start-button-hover-background);
            border-color: var(--start-button-hover-border);
        }

        .loading {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--placeholder-color);
        }

        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--button-border);
            border-top: 2px solid var(--focus-border-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .error {
            background: rgba(255, 68, 68, 0.1);
            border: 1px solid #ff4444;
            color: #ff4444;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
        }

        .success {
            background: rgba(68, 255, 68, 0.1);
            border: 1px solid #44ff44;
            color: #44ff44;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
        }

        .tech-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
        }

        .tech-tag {
            background: var(--focus-border-color);
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 500;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--placeholder-color);
        }

        .empty-icon {
            font-size: 64px;
            margin-bottom: 16px;
            opacity: 0.3;
        }
    `;

    static properties = {
        projects: { type: Array },
        isUploading: { type: Boolean },
        uploadError: { type: String },
        successMessage: { type: String }
    };

    constructor() {
        super();
        this.projects = [];
        this.isUploading = false;
        this.uploadError = '';
        this.successMessage = '';
        this.loadProjects();
    }

    async loadProjects() {
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('get-analyzed-projects');
            if (result.success) {
                this.projects = result.projects;
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
    }

    async handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        const zipFiles = files.filter(file => file.name.endsWith('.zip'));
        
        if (zipFiles.length === 0) {
            this.uploadError = 'Please drop a ZIP file containing your project.';
            return;
        }

        await this.uploadProject(zipFiles[0]);
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.zip')) {
            this.uploadProject(file);
        } else {
            this.uploadError = 'Please select a ZIP file.';
        }
    }

    async uploadProject(file) {
        this.isUploading = true;
        this.uploadError = '';
        this.successMessage = '';

        try {
            const buffer = await file.arrayBuffer();
            const projectName = file.name.replace('.zip', '');

            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('analyze-project', {
                buffer: Array.from(new Uint8Array(buffer)),
                name: projectName
            });

            if (result.success) {
                this.successMessage = `Project "${projectName}" analyzed successfully!`;
                await this.loadProjects(); // Refresh the list
                
                // Clear success message after 3 seconds
                setTimeout(() => {
                    this.successMessage = '';
                }, 3000);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.uploadError = `Failed to analyze project: ${error.message}`;
        } finally {
            this.isUploading = false;
        }
    }

    async activateProject(projectName) {
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('activate-project', projectName);
            if (result.success) {
                this.dispatchEvent(new CustomEvent('project-activated', {
                    detail: { projectName },
                    bubbles: true
                }));
            }
        } catch (error) {
            this.uploadError = `Failed to activate project: ${error.message}`;
        }
    }

    async deleteProject(projectName) {
        if (confirm(`Are you sure you want to delete the analysis for "${projectName}"?`)) {
            try {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('delete-project', projectName);
                if (result.success) {
                    await this.loadProjects();
                }
            } catch (error) {
                this.uploadError = `Failed to delete project: ${error.message}`;
            }
        }
    }

    formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString();
    }

    formatFileSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    render() {
        return html`
            <div class="container">
                <div class="header">
                    <span style="font-size: 24px;">🔍</span>
                    <h2>Project Code Analysis</h2>
                </div>

                ${this.uploadError ? html`
                    <div class="error">
                        ❌ ${this.uploadError}
                    </div>
                ` : ''}

                ${this.successMessage ? html`
                    <div class="success">
                        ✅ ${this.successMessage}
                    </div>
                ` : ''}

                <div class="upload-section" 
                     @dragover=${this.handleDragOver}
                     @dragleave=${this.handleDragLeave}
                     @drop=${this.handleDrop}>
                    
                    ${this.isUploading ? html`
                        <div class="loading">
                            <div class="spinner"></div>
                            <span>Analyzing project structure and code...</span>
                        </div>
                    ` : html`
                        <div class="upload-icon">📦</div>
                        <div class="upload-text">
                            <strong>Upload your project ZIP file</strong><br>
                            Drag & drop or click to browse
                        </div>
                        <button class="upload-button" @click=${() => this.shadowRoot.querySelector('.file-input').click()}>
                            Browse Files
                        </button>
                        <input type="file" class="file-input" accept=".zip" @change=${this.handleFileSelect}>
                    `}
                </div>

                <div class="projects-list">
                    <div class="projects-header">
                        <div class="projects-title">Analyzed Projects (${this.projects.length})</div>
                    </div>

                    ${this.projects.length === 0 ? html`
                        <div class="empty-state">
                            <div class="empty-icon">📂</div>
                            <div>No projects analyzed yet.</div>
                            <div>Upload a ZIP file to get started!</div>
                        </div>
                    ` : ''}

                    ${this.projects.map(project => html`
                        <div class="project-item">
                            <div class="project-header">
                                <div class="project-name">${project.name}</div>
                                <div class="project-date">${this.formatDate(project.timestamp)}</div>
                            </div>

                            <div class="project-stats">
                                <div class="stat-item">
                                    <span class="stat-number">${project.stats.totalFiles}</span>
                                    <span class="stat-label">Files</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${project.stats.totalLines.toLocaleString()}</span>
                                    <span class="stat-label">Lines</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${project.stats.functionCount}</span>
                                    <span class="stat-label">Functions</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${project.stats.classCount}</span>
                                    <span class="stat-label">Classes</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${this.formatFileSize(project.stats.totalSize)}</span>
                                    <span class="stat-label">Size</span>
                                </div>
                            </div>

                            <div class="tech-tags">
                                ${project.analysis.technologies.map(tech => html`
                                    <span class="tech-tag">${tech}</span>
                                `)}
                            </div>

                            <div class="project-actions">
                                <button class="action-button primary" @click=${() => this.activateProject(project.name)}>
                                    🎯 Activate for Q&A
                                </button>
                                <button class="action-button" @click=${() => this.showProjectDetails(project)}>
                                    📊 View Details
                                </button>
                                <button class="action-button" @click=${() => this.deleteProject(project.name)}>
                                    🗑️ Delete
                                </button>
                            </div>
                        </div>
                    `)}
                </div>
            </div>
        `;
    }

    showProjectDetails(project) {
        this.dispatchEvent(new CustomEvent('show-project-details', {
            detail: { project },
            bubbles: true
        }));
    }
}

customElements.define('project-analysis-view', ProjectAnalysisView);
