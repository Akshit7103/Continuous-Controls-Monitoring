// Table Display and Download Handler
export class TableDisplay {
    constructor(app) {
        this.app = app;
        this.DISPLAY_LIMIT = 100; // Maximum rows to display in UI
    }

    createResultsTable(results, rowCount) {
        if (!results || results.length === 0) {
            return '<p style="color: var(--text-secondary);">No results found.</p>';
        }

        const columns = Object.keys(results[0]);
        const displayResults = results.slice(0, this.DISPLAY_LIMIT);
        const hasMoreRows = results.length > this.DISPLAY_LIMIT;

        // Notification banner for truncated results
        const truncationNotice = hasMoreRows ? `
            <div class="truncation-notice">
                <span class="truncation-icon">ℹ️</span>
                <span class="truncation-message">
                    Showing first ${this.DISPLAY_LIMIT} of ${rowCount.toLocaleString()} rows.
                    <strong>Download the full dataset</strong> to view all results.
                </span>
            </div>
        ` : '';

        const tableHtml = `
            <div class="results-container">
                <div class="results-header">
                    <span class="results-count">
                        Found ${rowCount.toLocaleString()} result${rowCount !== 1 ? 's' : ''}
                        ${hasMoreRows ? `<span class="showing-count">(showing ${this.DISPLAY_LIMIT})</span>` : ''}
                    </span>
                    <div class="download-buttons">
                        <button class="btn-download csv" data-format="csv">
                            📄 Download CSV
                        </button>
                        <button class="btn-download excel" data-format="excel">
                            📊 Download Excel
                        </button>
                    </div>
                </div>
                ${truncationNotice}
                <div class="results-table-wrapper">
                    <table class="results-table">
                        <thead>
                            <tr>
                                ${columns.map(col => `<th>${this.escapeHtml(col)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${displayResults.map(row => `
                                <tr>
                                    ${columns.map(col => `
                                        <td>${this.formatValue(row[col])}</td>
                                    `).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        return tableHtml;
    }

    setupDownloadButtons(messageDiv, data, sqlQuery = null, tableName = null) {
        const downloadButtons = messageDiv.querySelectorAll('.btn-download');

        downloadButtons.forEach(btn => {
            btn.addEventListener('click', async () => {
                const format = btn.dataset.format;
                await this.downloadResults(data, format, sqlQuery, tableName);
            });
        });
    }

    async downloadResults(data, format, sqlQuery = null, tableName = null) {
        try {
            const filename = `query_results_${Date.now()}`;

            // Show loading toast for large downloads
            if (data.length > 1000) {
                this.app.showToast('info', `Preparing ${format.toUpperCase()} download...`);
            }

            if (format === 'csv') {
                // For CSV, use client-side download (faster for most cases)
                this.downloadAsCSV(data, filename);
            } else if (format === 'excel') {
                // For Excel, use backend for better formatting and large file support
                await this.downloadAsExcel(data, filename, sqlQuery, tableName);
            }

            this.app.showToast('success', `Downloaded ${data.length.toLocaleString()} rows as ${format.toUpperCase()}`);

        } catch (error) {
            console.error('Download error:', error);
            this.app.showToast('error', 'Failed to download results');
        }
    }

    downloadAsCSV(data, filename) {
        // Convert to CSV
        const columns = Object.keys(data[0]);
        const csvContent = [
            columns.join(','),
            ...data.map(row =>
                columns.map(col => {
                    let value = row[col];
                    if (value === null || value === undefined) value = '';
                    value = String(value);
                    // Escape quotes and wrap in quotes if contains comma or quote
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        value = '"' + value.replace(/"/g, '""') + '"';
                    }
                    return value;
                }).join(',')
            )
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    async downloadAsExcel(data, filename, sqlQuery = null, tableName = null) {
        try {
            // Prepare request payload
            const requestBody = {
                filename: filename
            };

            // Use SQL query method for large datasets (more efficient)
            if (sqlQuery && tableName && data.length > 100) {
                requestBody.sql_query = sqlQuery;
                requestBody.table_name = tableName;
            } else {
                // Use data method for small datasets
                requestBody.data = data;
            }

            const response = await fetch(`${this.app.apiBaseUrl}/download/excel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to generate Excel file');
            }

            // Get blob from response
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${filename}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Excel download error:', error);
            throw error;
        }
    }

    formatValue(value) {
        if (value === null || value === undefined) {
            return '<span style="color: var(--text-muted);">NULL</span>';
        }

        if (typeof value === 'number') {
            // Format numbers with commas for thousands
            if (Number.isInteger(value)) {
                return value.toLocaleString();
            } else {
                return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
            }
        }

        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }

        // Truncate long strings
        const strValue = String(value);
        if (strValue.length > 100) {
            return this.escapeHtml(strValue.substring(0, 100)) + '...';
        }

        return this.escapeHtml(strValue);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
