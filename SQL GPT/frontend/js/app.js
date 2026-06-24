// Main Application Logic
import { FileUploadHandler } from './fileUpload.js';
import { ChatInterface } from './chatInterface.js';
import { TableDisplay } from './tableDisplay.js';
import { HeroAnimation } from './heroAnimation.js';

class AnalyticsGPTApp {
    constructor() {
        this.apiBaseUrl = '/api';
        this.currentTable = null;
        this.tables = [];

        // Initialize modules
        this.fileUpload = new FileUploadHandler(this);
        this.chat = new ChatInterface(this);
        this.tableDisplay = new TableDisplay(this);
        this.heroAnimation = new HeroAnimation();

        // Initialize app
        this.init();
    }

    // New, compact and filter-aware renderer for the tables list
    renderTablesList() {
        const tablesList = document.getElementById('tablesList');
        const tableSearch = document.getElementById('tableSearch');
        const tablesCount = document.getElementById('tablesCount');

        const query = (tableSearch?.value || '').toLowerCase().trim();
        const filtered = query
            ? this.tables.filter(t => t.name.toLowerCase().includes(query))
            : this.tables;

        if (tablesCount) {
            tablesCount.textContent = `${filtered.length}/${this.tables.length}`;
        }

        if (!this.tables || this.tables.length === 0) {
            tablesList.innerHTML = '<p class="empty-message">No tables uploaded yet</p>';
            return;
        }

        if (filtered.length === 0) {
            tablesList.innerHTML = '<p class="empty-message">No matching tables</p>';
            return;
        }

        tablesList.innerHTML = filtered.map(table => `
            <div class="table-item ${table.name === this.currentTable ? 'active' : ''}"
                 data-table-name="${table.name}" title="${table.name}">
                <div class="table-header-flex" style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="table-name">${table.name}</div>
                    <button class="btn-delete-table" data-delete-name="${table.name}" title="Delete Table">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="table-meta">${table.row_count} rows · ${table.columns.length} columns</div>
            </div>
        `).join('');

        // Add click handlers
        tablesList.querySelectorAll('.table-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-table')) return;
                const tableName = item.dataset.tableName;
                this.selectTable(tableName);
            });
        });

        // Add delete handlers
        tablesList.querySelectorAll('.btn-delete-table').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tableName = btn.dataset.deleteName;
                if (confirm(`Are you sure you want to delete the table "${tableName}"?`)) {
                    this.deleteTable(tableName);
                }
            });
        });
    }

    async init() {
        console.log('🚀 Analytics GPT App Initializing...');

        // Load existing tables
        await this.loadTables();

        // Setup event listeners
        this.setupEventListeners();

        // Run hero animation
        this.heroAnimation.init();

        console.log('✅ Analytics GPT App Ready');
    }

    setupEventListeners() {
        // Clear chat button
        const clearChatBtn = document.getElementById('clearChatBtn');
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', () => this.chat.clearChat());
        }

        // Sidebar Toggle
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => {
                document.querySelector('.main-content').classList.toggle('sidebar-collapsed');
            });
        }

        // Tables search filter
        const tableSearch = document.getElementById('tableSearch');
        if (tableSearch) {
            tableSearch.addEventListener('input', () => this.renderTablesList());
        }
    }

    async loadTables() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/tables`);

            if (!response.ok) {
                throw new Error('Failed to load tables');
            }

            const data = await response.json();

            this.tables = data.tables || [];
            this.renderTablesList();

            // Select first table if available
            if (this.tables.length > 0 && !this.currentTable) {
                this.selectTable(this.tables[0].name);
            }

        } catch (error) {
            console.error('Error loading tables:', error);
        }
    }

    updateTablesList() {
        this.renderTablesList();
    }

    async deleteTable(tableName) {
        try {
            this.showLoading('Deleting table...');
            const response = await fetch(`${this.apiBaseUrl}/table/${tableName}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to delete table');
            }

            this.showToast('success', `Table ${tableName} deleted successfully`);
            
            if (this.currentTable === tableName) {
                this.currentTable = null;
                const currentTableInfo = document.getElementById('currentTableInfo');
                if (currentTableInfo) {
                    currentTableInfo.innerHTML = `
                        <div class="empty-state">
                            <p class="empty-message">Select a table to get started</p>
                        </div>
                    `;
                }
                const chatInput = document.getElementById('chatInput');
                const sendBtn = document.getElementById('sendBtn');
                if (chatInput) chatInput.disabled = true;
                if (sendBtn) sendBtn.disabled = true;
            }

            await this.loadTables();
            this.hideLoading();

        } catch (error) {
            this.hideLoading();
            console.error('Error deleting table:', error);
            this.showToast('error', error.message);
        }
    }

    async selectTable(tableName) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/schema/${tableName}`);

            if (!response.ok) {
                throw new Error('Failed to load table schema');
            }

            const data = await response.json();

            this.currentTable = tableName;
            this.updateCurrentTableInfo(data);
            this.renderTablesList();

            // Enable chat input
            const chatInput = document.getElementById('chatInput');
            const sendBtn = document.getElementById('sendBtn');
            if (chatInput) chatInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;

            this.showToast('success', `Switched to table: ${tableName}`);

        } catch (error) {
            console.error('Error selecting table:', error);
            this.showToast('error', 'Failed to load table information');
        }
    }

    updateCurrentTableInfo(schema) {
        const currentTableInfo = document.getElementById('currentTableInfo');

        currentTableInfo.innerHTML = `
            <div class="table-info-item">
                <div class="table-info-label">Table Name</div>
                <div class="table-info-value">${schema.table_name}</div>
            </div>
            <div class="table-info-item">
                <div class="table-info-label">Columns</div>
                <div class="table-info-value">${schema.columns.length} columns</div>
            </div>
            <div class="table-info-item">
                <div class="table-info-label">Column Names</div>
                <div class="table-info-value" style="font-size: 0.85rem;">
                    ${schema.columns.map(col => col.name).join(', ')}
                </div>
            </div>
        `;
    }

    showToast(type, message) {
        const toast = document.getElementById('toast');
        const toastIcon = document.getElementById('toastIcon');
        const toastMessage = document.getElementById('toastMessage');

        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠',
            info: 'ℹ'
        };

        toast.className = `toast ${type}`;
        toastIcon.textContent = icons[type] || icons.info;
        toastMessage.textContent = message;

        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    showLoading(text = 'Processing...') {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = overlay.querySelector('.loading-text');
        if (loadingText) loadingText.textContent = text;
        overlay.style.display = 'flex';
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        overlay.style.display = 'none';
    }

    async handleFileUpload(file) {
        try {
            this.showLoading('Uploading and processing file...');

            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${this.apiBaseUrl}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Upload failed');
            }

            const data = await response.json();

            // Reload tables list
            await this.loadTables();

            // Select the newly uploaded table
            this.selectTable(data.table_name);

            // Hide welcome message
            const welcomeMessage = document.querySelector('.welcome-message');
            if (welcomeMessage) {
                welcomeMessage.style.display = 'none';
            }

            this.hideLoading();
            this.showToast('success', `Successfully uploaded: ${data.table_name}`);

            return data;

        } catch (error) {
            this.hideLoading();
            this.showToast('error', error.message);
            throw error;
        }
    }

    async sendQuery(question) {
        if (!this.currentTable) {
            this.showToast('error', 'Please upload a file first');
            return null;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    question: question,
                    table_name: this.currentTable
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Query failed');
            }

            const data = await response.json();
            return data;

        } catch (error) {
            this.showToast('error', error.message);
            throw error;
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.analyticsGPT = new AnalyticsGPTApp();
});

export default AnalyticsGPTApp;
