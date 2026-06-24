import re
import time
from typing import Tuple, List, Dict, Any
import sqlparse


class QueryExecutor:
    """Service for safely executing SQL queries with validation"""

    # Dangerous SQL keywords that should be blocked
    FORBIDDEN_KEYWORDS = [
        'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER',
        'CREATE', 'TRUNCATE', 'REPLACE', 'RENAME',
        'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK',
        'EXEC', 'EXECUTE', 'PRAGMA'
    ]

    # Allowed keywords for read-only queries
    ALLOWED_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET']

    @staticmethod
    def validate_query(sql: str, table_name: str = None) -> Tuple[bool, str]:
        """
        Validate SQL query for security

        Args:
            sql: SQL query string
            table_name: Expected table name (optional)

        Returns:
            Tuple of (is_valid, error_message)
        """
        if not sql or not sql.strip():
            return False, "Empty query"

        sql_upper = sql.upper()

        # Must be a SELECT statement
        if not sql_upper.strip().startswith('SELECT'):
            return False, "Only SELECT queries are allowed"

        # Check for forbidden keywords
        for keyword in QueryExecutor.FORBIDDEN_KEYWORDS:
            # Use word boundaries to avoid false positives
            pattern = r'\b' + keyword + r'\b'
            if re.search(pattern, sql_upper):
                return False, f"Forbidden keyword detected: {keyword}"

        # Check for SQL injection patterns
        injection_patterns = [
            r';\s*SELECT',  # Multiple statements
            r';\s*DROP',
            r';\s*DELETE',
            r'--',  # SQL comments
            r'/\*',  # Multi-line comments
            r'\bUNION\b.*\bSELECT\b',  # UNION-based injection (basic check)
        ]

        for pattern in injection_patterns:
            if re.search(pattern, sql_upper):
                return False, "Potentially unsafe SQL pattern detected"

        # Validate table name if provided
        if table_name:
            if table_name.upper() not in sql_upper:
                return False, f"Query must reference table: {table_name}"

        # Check for basic SQL syntax
        if 'FROM' not in sql_upper:
            return False, "Invalid SQL: missing FROM clause"

        return True, ""

    @staticmethod
    def sanitize_query(sql: str) -> str:
        """
        Sanitize SQL query

        Args:
            sql: Raw SQL query

        Returns:
            Sanitized SQL query
        """
        # Remove trailing semicolons
        sql = sql.rstrip(';').strip()

        # Format SQL using sqlparse (optional, for readability)
        try:
            sql = sqlparse.format(
                sql,
                reindent=True,
                keyword_case='upper'
            )
        except:
            pass  # If formatting fails, use original

        return sql

    @staticmethod
    def execute_safe_query(
        database_service,
        sql: str,
        table_name: str = None
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        """
        Execute query safely with validation

        Args:
            database_service: DatabaseService instance
            sql: SQL query
            table_name: Expected table name

        Returns:
            Tuple of (results, execution_time, error_message)
        """
        # Validate query
        is_valid, error_msg = QueryExecutor.validate_query(sql, table_name)

        if not is_valid:
            return [], "0s", error_msg

        # Sanitize query
        sql = QueryExecutor.sanitize_query(sql)

        # Execute query with timing
        start_time = time.time()

        try:
            results = database_service.execute_query(sql)
            execution_time = time.time() - start_time

            return results, f"{execution_time:.3f}s", ""

        except Exception as e:
            execution_time = time.time() - start_time
            return [], f"{execution_time:.3f}s", f"Query execution error: {str(e)}"

    @staticmethod
    def analyze_query(sql: str) -> Dict[str, Any]:
        """
        Analyze SQL query and extract information

        Args:
            sql: SQL query

        Returns:
            Dict with query analysis
        """
        sql_upper = sql.upper()

        analysis = {
            "type": "SELECT",
            "has_where": "WHERE" in sql_upper,
            "has_join": "JOIN" in sql_upper,
            "has_group_by": "GROUP BY" in sql_upper,
            "has_order_by": "ORDER BY" in sql_upper,
            "has_limit": "LIMIT" in sql_upper,
            "has_aggregation": any(func in sql_upper for func in ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'])
        }

        return analysis

    @staticmethod
    def explain_query(sql: str) -> str:
        """
        Generate human-readable explanation of SQL query

        Args:
            sql: SQL query

        Returns:
            Explanation string
        """
        analysis = QueryExecutor.analyze_query(sql)

        explanation = "This query "

        if analysis["has_aggregation"]:
            explanation += "calculates aggregate values "
        else:
            explanation += "retrieves data "

        if analysis["has_where"]:
            explanation += "with filtering conditions "

        if analysis["has_join"]:
            explanation += "by joining multiple tables "

        if analysis["has_group_by"]:
            explanation += "grouped by specific columns "

        if analysis["has_order_by"]:
            explanation += "and sorts the results "

        if analysis["has_limit"]:
            explanation += "with a row limit"

        return explanation.strip() + "."
