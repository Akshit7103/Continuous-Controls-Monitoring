// Chat Interface Handler
import { TableDisplay } from './tableDisplay.js';

export class ChatInterface {
    constructor(app) {
        this.app = app;
        this.chatContainer = document.getElementById('chatContainer');
        this.chatInput = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.messages = [];

        this.init();
    }

    init() {
        // Send button click
        this.sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        // Enter key to send
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.chatInput.addEventListener('input', () => {
            this.autoResizeTextarea();
        });
    }

    autoResizeTextarea() {
        this.chatInput.style.height = 'auto';
        this.chatInput.style.height = this.chatInput.scrollHeight + 'px';
    }

    async sendMessage() {
        const question = this.chatInput.value.trim();

        if (!question) return;

        // Clear input
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';

        // Add user message
        this.addMessage('user', question);

        // Show thinking indicator
        const thinkingId = this.addThinkingIndicator();

        try {
            // Send query to backend
            const result = await this.app.sendQuery(question);

            // Remove thinking indicator
            this.removeThinkingIndicator(thinkingId);

            if (result) {
                // Add assistant response
                this.addQueryResult(result);
            }

        } catch (error) {
            this.removeThinkingIndicator(thinkingId);
            this.addMessage('assistant', `Error: ${error.message}`);
        }
    }

    addMessage(role, content) {
        // Remove welcome message if exists
        const welcomeMessage = this.chatContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.innerHTML = `
            <div class="message-avatar">${role === 'user' ? '👤' : '🤖'}</div>
            <div class="message-content">
                <div class="message-text">${this.escapeHtml(content)}</div>
            </div>
        `;

        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottom();

        this.messages.push({ role, content });
    }

    addQueryResult(result) {
        // Remove welcome message if exists
        const welcomeMessage = this.chatContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';

        const sqlHtml = `
            <div class="sql-label">Generated SQL Query:</div>
            <div class="sql-query">${this.escapeHtml(result.sql_query)}</div>
        `;

        const resultsHtml = result.row_count > 0
            ? this.app.tableDisplay.createResultsTable(result.results, result.row_count)
            : '<p style="color: var(--text-secondary); margin-top: 0.5rem;">No results found.</p>';

        messageDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                ${sqlHtml}
                ${resultsHtml}
            </div>
        `;

        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottom();

        // Setup download buttons if results exist
        if (result.row_count > 0) {
            // Pass SQL query and table name for efficient large dataset downloads
            this.app.tableDisplay.setupDownloadButtons(
                messageDiv,
                result.results,
                result.sql_query,
                this.app.currentTable
            );
        }

        this.messages.push({ role: 'assistant', content: result });
    }

    addThinkingIndicator() {
        const thinkingId = 'thinking-' + Date.now();
        const thinkingDiv = document.createElement('div');
        thinkingDiv.id = thinkingId;
        thinkingDiv.className = 'message assistant';
        thinkingDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="message-text">
                    <div class="thinking">
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                </div>
            </div>
        `;

        this.chatContainer.appendChild(thinkingDiv);
        this.scrollToBottom();

        return thinkingId;
    }

    removeThinkingIndicator(thinkingId) {
        const thinkingDiv = document.getElementById(thinkingId);
        if (thinkingDiv) {
            thinkingDiv.remove();
        }
    }

    clearChat() {
        // Keep only the welcome message
        this.chatContainer.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">👋</div>
                <h2>Welcome to Analytics GPT!</h2>
                <p>Upload your data file (CSV or Excel) to get started.</p>
                <p class="welcome-subtext">Once uploaded, you can ask questions about your data in plain English.</p>
            </div>
        `;

        this.messages = [];
        this.app.showToast('success', 'Chat cleared');
    }

    scrollToBottom() {
        setTimeout(() => {
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        }, 100);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
