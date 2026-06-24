from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime


class UploadResponse(BaseModel):
    """Response model for file upload"""
    success: bool
    table_name: str
    rows_count: int
    columns: List[str]
    table_schema: Dict[str, str]
    preview: List[Dict[str, Any]]
    message: str = "File uploaded successfully"


class QueryRequest(BaseModel):
    """Request model for natural language query"""
    question: str = Field(..., min_length=1, description="Natural language question")
    table_name: str = Field(..., min_length=1, description="Target table name")


class QueryResponse(BaseModel):
    """Response model for query execution"""
    success: bool
    question: str
    sql_query: str
    results: List[Dict[str, Any]]
    row_count: int
    execution_time: str
    message: Optional[str] = None


class TableInfo(BaseModel):
    """Model for table information"""
    name: str
    row_count: int
    columns: List[str]
    created_at: str


class TablesResponse(BaseModel):
    """Response model for listing tables"""
    success: bool
    tables: List[TableInfo]


class SchemaResponse(BaseModel):
    """Response model for table schema"""
    success: bool
    table_name: str
    columns: List[Dict[str, str]]
    sample_data: List[Dict[str, Any]]


class ErrorResponse(BaseModel):
    """Response model for errors"""
    success: bool = False
    error: str
    details: Optional[str] = None
