# Analytics GPT - Natural Language Database Query Interface

A powerful web application that allows you to query your data using natural language. Upload CSV or Excel files and ask questions in plain English - Analytics GPT converts them to SQL queries and returns the results.

## Features

- **Natural Language Queries**: Ask questions about your data in plain English
- **Multiple File Formats**: Support for CSV, Excel (.xlsx, .xls)
- **Smart SQL Generation**: Powered by OpenAI GPT models
- **Interactive Results**: View, sort, and filter query results
- **Export Results**: Download results as CSV or Excel
- **Multiple Tables**: Upload and query multiple datasets
- **Security First**: Built-in SQL injection prevention and query validation
- **Modern UI**: Clean, responsive interface with real-time updates

## Technology Stack

### Backend
- **FastAPI**: Modern Python web framework
- **Pandas**: Data processing and manipulation
- **SQLite**: Database storage
- **OpenAI API**: Natural language to SQL conversion
- **Uvicorn**: ASGI server

### Frontend
- **HTML5/CSS3**: Modern, responsive UI
- **Vanilla JavaScript**: No framework dependencies
- **Modular Architecture**: Clean separation of concerns

## Project Structure

```
analytics-gpt/
├── backend/
│   ├── api/
│   │   ├── upload.py       # File upload endpoints
│   │   ├── query.py        # Query processing endpoints
│   │   └── download.py     # Download endpoints
│   ├── services/
│   │   ├── database.py     # SQLite operations
│   │   ├── file_parser.py  # CSV/Excel parsing
│   │   ├── llm_service.py  # OpenAI integration
│   │   └── query_executor.py # SQL execution & validation
│   ├── models/
│   │   └── schemas.py      # Pydantic models
│   ├── uploads/            # Temporary file storage
│   ├── databases/          # SQLite databases
│   └── main.py             # FastAPI application
├── frontend/
│   ├── css/
│   │   └── styles.css      # Application styles
│   ├── js/
│   │   ├── app.js          # Main application logic
│   │   ├── fileUpload.js   # File upload handler
│   │   ├── chatInterface.js # Chat UI handler
│   │   └── tableDisplay.js # Results display
│   └── index.html          # Main HTML file
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variables template
└── README.md              # This file
```

## Installation

### Prerequisites

- Python 3.9 or higher
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

### Step 1: Clone or Download

```bash
cd "Analytics GPT"
```

### Step 2: Create Virtual Environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### Step 3: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   # Windows
   copy .env.example .env

   # macOS/Linux
   cp .env.example .env
   ```

2. Edit `.env` and add your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-your-actual-api-key-here
   ```

### Step 5: Run the Application

```bash
cd backend
python main.py
```

The application will start on `http://localhost:8000`

## Usage

### 1. Upload Data

- Click the upload area or drag and drop a CSV or Excel file
- Supported formats: `.csv`, `.xlsx`, `.xls`
- Maximum file size: 50MB
- The file will be processed and converted to a SQLite table

### 2. Ask Questions

Once your data is uploaded, ask questions in natural language:

**Example Questions:**

- "Show me all records where salary is greater than 100000"
- "What is the average age of employees?"
- "List the top 10 customers by revenue"
- "How many orders were placed in 2023?"
- "Show employees from the Engineering department"

### 3. View Results

- Results are displayed in an interactive table
- The generated SQL query is shown for transparency
- Row count and execution time are displayed

### 4. Download Results

- Click "Download CSV" for CSV format
- Click "Download Excel" for Excel format
- Files are named with timestamps for easy organization

### 5. Multiple Tables

- Upload multiple files to work with different datasets
- Switch between tables using the sidebar
- Each table maintains its own schema and data

## API Endpoints

### Upload File
```
POST /api/upload
Content-Type: multipart/form-data

Response: Table information with schema and preview
```

### Query Data
```
POST /api/query
Content-Type: application/json
Body: {
  "question": "Show employees with salary > 100k",
  "table_name": "employees"
}

Response: SQL query and results
```

### List Tables
```
GET /api/tables

Response: List of all uploaded tables
```

### Get Schema
```
GET /api/schema/{table_name}

Response: Table schema and sample data
```

### Download Results
```
POST /api/download/csv
POST /api/download/excel

Response: File download
```

## Security Features

### SQL Injection Prevention
- Only `SELECT` queries are allowed
- Forbidden keywords are blocked (DROP, DELETE, UPDATE, etc.)
- Query validation before execution
- Parameterized queries where applicable

### File Upload Security
- File type validation
- File size limits (50MB)
- Virus scanning recommended for production
- Temporary file cleanup

### Data Privacy
- All data is stored locally in SQLite
- No data is sent to third parties (except query text to OpenAI)
- Database files are not exposed via API

## Configuration

### Change OpenAI Model

Edit `backend/services/llm_service.py`:

```python
self.model = "gpt-4o-mini"  # Default: Fast and cost-effective
# Options: "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"
```

### Change Upload Limits

Edit `backend/services/file_parser.py`:

```python
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
```

### CORS Configuration

For production, update `backend/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],  # Specify exact origins
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

## Troubleshooting

### "OpenAI API key not provided"
- Ensure `.env` file exists in the project root
- Verify `OPENAI_API_KEY` is set correctly
- Restart the server after changing `.env`

### "Table not found"
- Upload a file first
- Check that the upload was successful
- Verify the table name in the sidebar

### "Query execution error"
- Check the generated SQL query
- Verify column names match your data
- Ensure data types are compatible

### File Upload Fails
- Check file format (CSV, XLSX, XLS only)
- Verify file size is under 50MB
- Ensure file is not corrupted
- Check file encoding (UTF-8 recommended)

## Development

### Running in Development Mode

The server runs with auto-reload enabled by default:

```bash
cd backend
python main.py
```

### API Documentation

FastAPI provides automatic API documentation:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### Adding New Features

1. **Backend**: Add new endpoints in `backend/api/`
2. **Frontend**: Create new modules in `frontend/js/`
3. **Services**: Add business logic in `backend/services/`

## Deployment

### Production Checklist

- [ ] Set proper CORS origins
- [ ] Use environment variables for secrets
- [ ] Enable HTTPS
- [ ] Set up proper logging
- [ ] Configure file upload limits
- [ ] Add rate limiting
- [ ] Set up database backups
- [ ] Monitor API usage (OpenAI costs)

### Deploy to Cloud

**Recommended Platforms:**
- **Backend**: Render, Railway, Fly.io, AWS EC2
- **Frontend**: Vercel, Netlify (as static site)
- **All-in-one**: Use FastAPI to serve frontend (current setup)

## Performance Optimization

- Use `gpt-4o-mini` for faster, cheaper queries
- Cache common SQL queries
- Implement pagination for large result sets
- Use database indexing for better query performance
- Consider Redis for session management

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or suggestions:

1. Check the troubleshooting section
2. Review existing issues
3. Create a new issue with details

## Acknowledgments

- Built with FastAPI
- Powered by OpenAI
- UI inspired by modern design principles

## Roadmap

- [ ] Support for PostgreSQL/MySQL connections
- [ ] Query history and favorites
- [ ] Data visualization (charts/graphs)
- [ ] Multi-table JOIN queries
- [ ] User authentication
- [ ] Collaborative workspaces
- [ ] Export to PDF
- [ ] Scheduled queries
- [ ] Email alerts

---

**Built with ❤️ for data enthusiasts**

For more information, visit the [documentation](https://github.com/yourusername/analytics-gpt).
