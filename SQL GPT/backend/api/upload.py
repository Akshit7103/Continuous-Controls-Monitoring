from fastapi import APIRouter, UploadFile, File, HTTPException
from models.schemas import UploadResponse, ErrorResponse
from services import DatabaseService, FileParserService
import os
import uuid

router = APIRouter()

# Initialize services
db_service = DatabaseService()
file_parser = FileParserService()


@router.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    Upload and process CSV or Excel file

    Args:
        file: Uploaded file (CSV or Excel)

    Returns:
        UploadResponse with table information
    """
    try:
        # Validate file
        is_valid, error_msg = file_parser.validate_file(file)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

        # Generate table name
        table_name = file_parser.generate_table_name(file.filename)

        # Check if table already exists
        if db_service.table_exists(table_name):
            # Add unique suffix
            table_name = f"{table_name}_{uuid.uuid4().hex[:6]}"

        # Save and parse file
        save_path = os.path.join("backend/uploads", f"{uuid.uuid4().hex}_{file.filename}")
        df = await file_parser.parse_file(file, save_path)

        # Create table in database
        table_info = db_service.create_table_from_dataframe(df, table_name)

        # Clean up uploaded file
        try:
            os.remove(save_path)
        except:
            pass

        return UploadResponse(
            success=True,
            table_name=table_info["table_name"],
            rows_count=table_info["rows_count"],
            columns=table_info["columns"],
            table_schema=table_info["schema"],
            preview=table_info["preview"],
            message=f"Successfully uploaded {file.filename} as table '{table_name}'"
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
