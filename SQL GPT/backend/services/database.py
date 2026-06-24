import sqlite3
import os
import pandas as pd
from typing import List, Dict, Any, Tuple
from datetime import datetime
import json


class DatabaseService:
    """Service for SQLite database operations"""

    def __init__(self, db_dir: str = "backend/databases"):
        self.db_dir = db_dir
        os.makedirs(db_dir, exist_ok=True)
        self.db_path = os.path.join(db_dir, "analytics_gpt.db")
        self._init_metadata_table()

    def _init_metadata_table(self):
        """Initialize metadata table to track uploaded tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS _metadata (
                table_name TEXT PRIMARY KEY,
                row_count INTEGER,
                columns TEXT,
                created_at TEXT
            )
        """)
        conn.commit()
        conn.close()

    def get_connection(self) -> sqlite3.Connection:
        """Get database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Enable column access by name
        return conn

    def create_table_from_dataframe(self, df: pd.DataFrame, table_name: str) -> Dict[str, Any]:
        """
        Create SQLite table from pandas DataFrame

        Args:
            df: pandas DataFrame
            table_name: Name for the table

        Returns:
            Dict with table information
        """
        conn = self.get_connection()

        try:
            # Drop table if exists
            conn.execute(f"DROP TABLE IF EXISTS {table_name}")

            # Prepare DataFrame for SQLite with better date handling
            df_to_insert = df.copy()

            # Convert datetime columns to ISO format strings for better SQLite compatibility
            datetime_columns = []
            for col in df_to_insert.columns:
                if pd.api.types.is_datetime64_any_dtype(df_to_insert[col]):
                    datetime_columns.append(col)
                    # Convert to ISO format string, preserve NaT as None
                    df_to_insert[col] = df_to_insert[col].apply(
                        lambda x: x.isoformat() if pd.notna(x) else None
                    )

            # Create table and insert data
            df_to_insert.to_sql(table_name, conn, if_exists='replace', index=False)

            # Get column info with enhanced type information
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns_info = cursor.fetchall()

            # Build schema with type hints
            schema = {}
            for col in columns_info:
                col_name = col[1]
                sql_type = col[2]

                # Add type hints for datetime columns
                if col_name in datetime_columns:
                    schema[col_name] = "DATETIME"
                else:
                    schema[col_name] = sql_type

            columns = list(schema.keys())

            # Store metadata with type information
            metadata = {
                "columns": columns,
                "datetime_columns": datetime_columns
            }

            cursor.execute("""
                INSERT OR REPLACE INTO _metadata (table_name, row_count, columns, created_at)
                VALUES (?, ?, ?, ?)
            """, (table_name, len(df), json.dumps(metadata), datetime.now().isoformat()))

            conn.commit()

            # Get preview data
            preview = self.execute_query(f"SELECT * FROM {table_name} LIMIT 10")

            return {
                "table_name": table_name,
                "rows_count": len(df),
                "columns": columns,
                "schema": schema,
                "preview": preview
            }

        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()

    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        """
        Execute SQL query and return results

        Args:
            query: SQL query string

        Returns:
            List of dictionaries representing rows
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query)

            # Get column names
            columns = [description[0] for description in cursor.description] if cursor.description else []

            # Fetch all rows
            rows = cursor.fetchall()

            # Convert to list of dicts
            results = []
            for row in rows:
                row_dict = {}
                for idx, col in enumerate(columns):
                    row_dict[col] = row[idx]
                results.append(row_dict)

            return results

        finally:
            conn.close()

    def get_table_schema(self, table_name: str) -> Dict[str, Any]:
        """
        Get schema information for a table

        Args:
            table_name: Name of the table

        Returns:
            Dict with schema information
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()

            # Get column information
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns_info = cursor.fetchall()

            if not columns_info:
                raise ValueError(f"Table '{table_name}' does not exist")

            columns = [
                {"name": col[1], "type": col[2]}
                for col in columns_info
            ]

            # Get sample data
            sample_data = self.execute_query(f"SELECT * FROM {table_name} LIMIT 5")

            return {
                "table_name": table_name,
                "columns": columns,
                "sample_data": sample_data
            }

        finally:
            conn.close()

    def get_all_tables(self) -> List[Dict[str, Any]]:
        """
        Get list of all user tables (excluding metadata)

        Returns:
            List of table information
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT table_name, row_count, columns, created_at
                FROM _metadata
                ORDER BY created_at DESC
            """)

            tables = []
            for row in cursor.fetchall():
                metadata = json.loads(row[2])

                # Handle both old format (list) and new format (dict)
                if isinstance(metadata, list):
                    columns = metadata
                else:
                    columns = metadata.get("columns", [])

                tables.append({
                    "name": row[0],
                    "row_count": row[1],
                    "columns": columns,
                    "created_at": row[3]
                })

            return tables

        finally:
            conn.close()

    def table_exists(self, table_name: str) -> bool:
        """Check if table exists"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name=?
            """, (table_name,))
            return cursor.fetchone() is not None
        finally:
            conn.close()

    def delete_table(self, table_name: str):
        """Delete a table and its metadata"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
            cursor.execute("DELETE FROM _metadata WHERE table_name = ?", (table_name,))
            conn.commit()
        finally:
            conn.close()
