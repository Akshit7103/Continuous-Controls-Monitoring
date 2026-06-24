// File Upload Handler
export class FileUploadHandler {
    constructor(app) {
        this.app = app;
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.uploadProgress = document.getElementById('uploadProgress');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');

        this.init();
    }

    init() {
        // Click to upload
        this.uploadArea.addEventListener('click', () => {
            this.fileInput.click();
        });

        // File selection
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFile(file);
            }
        });

        // Drag and drop
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.add('dragover');
        });

        this.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.uploadArea.classList.remove('dragover');

            const file = e.dataTransfer.files[0];
            if (file) {
                this.handleFile(file);
            }
        });
    }

    async handleFile(file) {
        // Validate file
        const validation = this.validateFile(file);
        if (!validation.valid) {
            this.app.showToast('error', validation.message);
            return;
        }

        try {
            // Show progress
            this.showProgress();

            // Upload file
            const result = await this.app.handleFileUpload(file);

            // Hide progress
            this.hideProgress();

            // Reset file input
            this.fileInput.value = '';

        } catch (error) {
            console.error('Upload error:', error);
            this.hideProgress();
            this.fileInput.value = '';
        }
    }

    validateFile(file) {
        const allowedExtensions = ['.csv', '.xlsx', '.xls'];
        const maxSize = 50 * 1024 * 1024; // 50MB

        // Check extension
        const extension = '.' + file.name.split('.').pop().toLowerCase();
        if (!allowedExtensions.includes(extension)) {
            return {
                valid: false,
                message: `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`
            };
        }

        // Check size
        if (file.size > maxSize) {
            return {
                valid: false,
                message: `File too large. Maximum size: 50MB`
            };
        }

        return { valid: true };
    }

    showProgress() {
        this.uploadArea.style.display = 'none';
        this.uploadProgress.style.display = 'block';
        this.progressFill.style.width = '0%';

        // Simulate progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            this.progressFill.style.width = `${progress}%`;
        }, 200);

        this.progressInterval = interval;
    }

    hideProgress() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }

        this.progressFill.style.width = '100%';

        setTimeout(() => {
            this.uploadArea.style.display = 'block';
            this.uploadProgress.style.display = 'none';
        }, 500);
    }
}
