from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from api import upload, query, download
import os
from pathlib import Path
from dotenv import load_dotenv

# Get base directory
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent

# Load environment variables from project root
load_dotenv(BASE_DIR / ".env")

# Create FastAPI app
app = FastAPI(
    title="Analytics GPT API",
    description="Natural Language to SQL Query Interface",
    version="1.0.0"
)

# CORS middleware - Allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(upload.router, prefix="/api", tags=["Upload"])
app.include_router(query.router, prefix="/api", tags=["Query"])
app.include_router(download.router, prefix="/api", tags=["Download"])

# Create necessary directories
os.makedirs(BACKEND_DIR / "uploads", exist_ok=True)
os.makedirs(BACKEND_DIR / "databases", exist_ok=True)


@app.get("/")
async def root():
    """Serve the frontend HTML"""
    return FileResponse(BASE_DIR / "frontend" / "index.html")


# Mount static files (CSS, JS)
app.mount("/css", StaticFiles(directory=str(BASE_DIR / "frontend" / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE_DIR / "frontend" / "js")), name="js")
app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "frontend" / "assets")), name="assets")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Analytics GPT API is running"}


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle uncaught exceptions"""
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal server error",
            "detail": str(exc)
        }
    )


if __name__ == "__main__":
    import uvicorn

    # Get port from environment variable (Render sets this automatically)
    port = int(os.getenv("PORT", 8000))

    # Check if running in production
    is_production = os.getenv("RENDER") is not None

    print("=" * 60)
    print("🚀 Analytics GPT Server Starting...")
    print("=" * 60)
    if not is_production:
        print("📍 Server: http://localhost:8000")
        print("📚 API Docs: http://localhost:8000/docs")
        print("🔍 Health Check: http://localhost:8000/health")
    else:
        print("🌐 Running in Production Mode")
        print(f"📍 Port: {port}")
    print("=" * 60)
    if not is_production:
        print("\n⚠️  Make sure OPENAI_API_KEY is set in .env file\n")

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=not is_production,  # Only auto-reload in development
        log_level="info"
    )
