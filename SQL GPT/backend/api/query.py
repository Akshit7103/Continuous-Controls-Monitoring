from fastapi import APIRouter, HTTPException
from models.schemas import QueryRequest, QueryResponse, ErrorResponse, TablesResponse, SchemaResponse, TableInfo
from services import DatabaseService, LLMService, QueryExecutor
import os

router = APIRouter()

# Initialize services
db_service = DatabaseService()
llm_service = None  # Will be initialized when API key is available
query_executor = QueryExecutor()


def get_llm_service():
    """Get or initialize LLM service"""
    global llm_service
    if llm_service is None:
        try:
            llm_service = LLMService()
        except ValueError as e:
            raise HTTPException(status_code=500, detail=str(e))
    return llm_service


@router.post("/query", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    """
    Process natural language query and return results

    Args:
        request: QueryRequest with question and table_name

    Returns:
        QueryResponse with SQL query and results
    """
    try:
        # Check if table exists
        if not db_service.table_exists(request.table_name):
            raise HTTPException(
                status_code=404,
                detail=f"Table '{request.table_name}' not found"
            )

        # Get table schema
        schema = db_service.get_table_schema(request.table_name)

        # Get LLM service
        llm = get_llm_service()

        # Generate SQL from natural language
        sql_query = llm.generate_sql(
            question=request.question,
            table_name=request.table_name,
            schema=schema,
            sample_data=schema.get('sample_data', [])
        )

        # Validate SQL
        if not llm.validate_response(sql_query):
            raise HTTPException(
                status_code=400,
                detail="Generated SQL query is invalid"
            )

        # Execute query safely
        results, execution_time, error = query_executor.execute_safe_query(
            database_service=db_service,
            sql=sql_query,
            table_name=request.table_name
        )

        if error:
            raise HTTPException(status_code=400, detail=error)

        return QueryResponse(
            success=True,
            question=request.question,
            sql_query=sql_query,
            results=results,
            row_count=len(results),
            execution_time=execution_time
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing query: {str(e)}")


@router.get("/tables", response_model=TablesResponse)
async def get_tables():
    """
    Get list of all uploaded tables

    Returns:
        TablesResponse with list of tables
    """
    try:
        tables = db_service.get_all_tables()

        table_infos = [
            TableInfo(
                name=table["name"],
                row_count=table["row_count"],
                columns=table["columns"],
                created_at=table["created_at"]
            )
            for table in tables
        ]

        return TablesResponse(success=True, tables=table_infos)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching tables: {str(e)}")


@router.get("/schema/{table_name}", response_model=SchemaResponse)
async def get_schema(table_name: str):
    """
    Get schema information for a specific table

    Args:
        table_name: Name of the table

    Returns:
        SchemaResponse with schema information
    """
    try:
        if not db_service.table_exists(table_name):
            raise HTTPException(
                status_code=404,
                detail=f"Table '{table_name}' not found"
            )

        schema = db_service.get_table_schema(table_name)

        return SchemaResponse(
            success=True,
            table_name=schema["table_name"],
            columns=schema["columns"],
            sample_data=schema["sample_data"]
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching schema: {str(e)}")


@router.delete("/table/{table_name}")
async def delete_table(table_name: str):
    """
    Delete a table

    Args:
        table_name: Name of the table to delete

    Returns:
        Success message
    """
    try:
        if not db_service.table_exists(table_name):
            raise HTTPException(
                status_code=404,
                detail=f"Table '{table_name}' not found"
            )

        db_service.delete_table(table_name)

        return {"success": True, "message": f"Table '{table_name}' deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting table: {str(e)}")
