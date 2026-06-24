from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import io
from services import DatabaseService

router = APIRouter()

# Initialize database service
db_service = DatabaseService()


class DownloadRequest(BaseModel):
    """Request model for downloading results"""
    data: Optional[List[Dict[str, Any]]] = None  # For backward compatibility
    sql_query: Optional[str] = None  # New: execute query on backend
    table_name: Optional[str] = None  # Required if using sql_query
    filename: str = "results"
    format: str = "csv"  # csv or excel


@router.post("/download/csv")
async def download_csv(request: DownloadRequest):
    """
    Download query results as CSV

    Args:
        request: DownloadRequest with data/sql_query and filename

    Returns:
        CSV file download
    """
    try:
        # Get data either from provided data or by executing query
        if request.sql_query and request.table_name:
            # Execute query on backend (efficient for large datasets)
            data = db_service.execute_query(request.sql_query)
            if not data:
                raise HTTPException(status_code=400, detail="Query returned no results")
        elif request.data:
            # Use provided data (backward compatibility)
            data = request.data
        else:
            raise HTTPException(status_code=400, detail="Either data or sql_query must be provided")

        # Convert to DataFrame
        df = pd.DataFrame(data)

        # Create CSV in memory with optimization for large files
        output = io.StringIO()
        df.to_csv(output, index=False, chunksize=1000)
        output.seek(0)

        # Return as streaming response
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={request.filename}.csv"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating CSV: {str(e)}")


@router.post("/download/excel")
async def download_excel(request: DownloadRequest):
    """
    Download query results as Excel

    Args:
        request: DownloadRequest with data/sql_query and filename

    Returns:
        Excel file download
    """
    try:
        # Get data either from provided data or by executing query
        if request.sql_query and request.table_name:
            # Execute query on backend (efficient for large datasets)
            data = db_service.execute_query(request.sql_query)
            if not data:
                raise HTTPException(status_code=400, detail="Query returned no results")
        elif request.data:
            # Use provided data (backward compatibility)
            data = request.data
        else:
            raise HTTPException(status_code=400, detail="Either data or sql_query must be provided")

        # Convert to DataFrame
        df = pd.DataFrame(data)

        # Create Excel in memory with optimization for large files
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # For very large datasets, you might want to add options like:
            # - Split into multiple sheets if > 1M rows
            # - Disable autofilter for performance
            df.to_excel(writer, index=False, sheet_name='Results')

            # Optional: Add some formatting for better readability
            worksheet = writer.sheets['Results']
            # Freeze the header row
            worksheet.freeze_panes = 'A2'

        output.seek(0)

        # Return as streaming response
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename={request.filename}.xlsx"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating Excel: {str(e)}")
