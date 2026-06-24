import pandas as pd
import os
from typing import Tuple
from fastapi import UploadFile
import re


class FileParserService:
    """Service for parsing uploaded files (CSV, Excel)"""

    ALLOWED_EXTENSIONS = {'.csv', '.xlsx', '.xls'}
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

    @staticmethod
    def validate_file(file: UploadFile) -> Tuple[bool, str]:
        """
        Validate uploaded file

        Args:
            file: UploadFile object

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Check file extension
        file_ext = os.path.splitext(file.filename)[1].lower()
        if file_ext not in FileParserService.ALLOWED_EXTENSIONS:
            return False, f"Invalid file type. Allowed: {', '.join(FileParserService.ALLOWED_EXTENSIONS)}"

        return True, ""

    @staticmethod
    def generate_table_name(filename: str) -> str:
        """
        Generate valid SQLite table name from filename

        Args:
            filename: Original filename

        Returns:
            Valid table name
        """
        # Remove extension
        name = os.path.splitext(filename)[0]

        # Replace spaces and special characters with underscore
        name = re.sub(r'[^a-zA-Z0-9_]', '_', name)

        # Ensure it starts with a letter
        if not name[0].isalpha():
            name = 'table_' + name

        # Lowercase and limit length
        name = name.lower()[:50]

        return name

    @staticmethod
    async def parse_file(file: UploadFile, save_path: str) -> pd.DataFrame:
        """
        Parse uploaded file to pandas DataFrame

        Args:
            file: UploadFile object
            save_path: Path to save the file temporarily

        Returns:
            pandas DataFrame

        Raises:
            ValueError: If file cannot be parsed
        """
        # Save file temporarily
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

        try:
            contents = await file.read()

            with open(save_path, 'wb') as f:
                f.write(contents)

            # Determine file type and parse
            file_ext = os.path.splitext(file.filename)[1].lower()

            if file_ext == '.csv':
                # Try different encodings
                for encoding in ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']:
                    try:
                        df = pd.read_csv(save_path, encoding=encoding)
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    raise ValueError("Unable to decode CSV file. Please check the file encoding.")

            elif file_ext in ['.xlsx', '.xls']:
                df = pd.read_excel(save_path)

            else:
                raise ValueError(f"Unsupported file type: {file_ext}")

            # Validate DataFrame
            if df.empty:
                raise ValueError("File is empty or contains no data")

            # Clean column names (remove special characters, spaces)
            df.columns = [FileParserService._clean_column_name(col) for col in df.columns]

            # Improve data type handling
            df = FileParserService._optimize_dtypes(df)

            return df

        except pd.errors.EmptyDataError:
            raise ValueError("File is empty")
        except pd.errors.ParserError as e:
            raise ValueError(f"Error parsing file: {str(e)}")
        except Exception as e:
            raise ValueError(f"Error reading file: {str(e)}")

    @staticmethod
    def _clean_column_name(col: str) -> str:
        """
        Clean column name for SQLite compatibility

        Args:
            col: Original column name

        Returns:
            Cleaned column name
        """
        # Convert to string if not already
        col = str(col)

        # Replace spaces and special characters
        col = re.sub(r'[^a-zA-Z0-9_]', '_', col)

        # Remove leading/trailing underscores
        col = col.strip('_')

        # Ensure it starts with a letter
        if col and not col[0].isalpha():
            col = 'col_' + col

        # Handle empty names
        if not col:
            col = 'column'

        return col.lower()

    @staticmethod
    def get_dataframe_info(df: pd.DataFrame) -> dict:
        """
        Get information about DataFrame

        Args:
            df: pandas DataFrame

        Returns:
            Dict with DataFrame information
        """
        return {
            "rows": len(df),
            "columns": list(df.columns),
            "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
            "memory_usage": f"{df.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB"
        }

    @staticmethod
    def _optimize_dtypes(df: pd.DataFrame) -> pd.DataFrame:
        """
        Optimize data types for better performance and SQLite compatibility

        Args:
            df: pandas DataFrame

        Returns:
            DataFrame with optimized data types
        """
        df = df.copy()

        for col in df.columns:
            # Skip if column is already datetime
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                continue

            # Try to convert to datetime if it looks like a date
            if df[col].dtype == 'object':
                # Sample first non-null value
                sample = df[col].dropna().head(100)

                if len(sample) > 0:
                    # Try datetime conversion
                    try:
                        converted = pd.to_datetime(sample, errors='coerce')
                        # If more than 80% of values are valid dates, convert the column
                        if converted.notna().sum() / len(sample) > 0.8:
                            df[col] = pd.to_datetime(df[col], errors='coerce')
                            continue
                    except:
                        pass

                    # Try numeric conversion for string numbers
                    try:
                        # Check if values look numeric
                        if sample.astype(str).str.match(r'^-?\d+\.?\d*$').sum() / len(sample) > 0.8:
                            df[col] = pd.to_numeric(df[col], errors='coerce')
                            continue
                    except:
                        pass

            # Handle missing values based on data type
            if pd.api.types.is_numeric_dtype(df[col]):
                # For numeric columns, keep NaN (will be stored as NULL in SQLite)
                pass
            elif pd.api.types.is_datetime64_any_dtype(df[col]):
                # For datetime columns, keep NaT (will be stored as NULL in SQLite)
                pass
            else:
                # For object/string columns, replace NaN with empty string
                df[col] = df[col].fillna('')

        return df
