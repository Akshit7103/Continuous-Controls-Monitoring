import os
from typing import Dict, List, Any
from openai import OpenAI
import json


class LLMService:
    """Service for LLM-based natural language to SQL conversion"""

    def __init__(self, api_key: str = None):
        """
        Initialize LLM service

        Args:
            api_key: OpenAI API key (defaults to env variable)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not provided. Set OPENAI_API_KEY environment variable.")

        self.client = OpenAI(api_key=self.api_key)
        self.model = "gpt-4o-mini"  # Fast and cost-effective

    def generate_sql(
        self,
        question: str,
        table_name: str,
        schema: Dict[str, Any],
        sample_data: List[Dict[str, Any]] = None
    ) -> str:
        """
        Generate SQL query from natural language question

        Args:
            question: Natural language question
            table_name: Name of the table
            schema: Table schema information
            sample_data: Optional sample data for context

        Returns:
            SQL query string

        Raises:
            Exception: If LLM call fails
        """
        prompt = self._build_prompt(question, table_name, schema, sample_data)

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a SQL expert. Convert natural language questions to SQLite queries. Return ONLY the SQL query, no explanations or markdown formatting."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0,  # Deterministic output
                max_tokens=500
            )

            sql_query = response.choices[0].message.content.strip()

            # Clean up the response (remove markdown code blocks if present)
            sql_query = self._clean_sql_response(sql_query)

            return sql_query

        except Exception as e:
            raise Exception(f"Error generating SQL: {str(e)}")

    def _build_prompt(
        self,
        question: str,
        table_name: str,
        schema: Dict[str, Any],
        sample_data: List[Dict[str, Any]] = None
    ) -> str:
        """
        Build prompt for LLM

        Args:
            question: Natural language question
            table_name: Name of the table
            schema: Table schema information
            sample_data: Optional sample data

        Returns:
            Formatted prompt string
        """
        # Build column descriptions
        columns_desc = []
        for col_info in schema['columns']:
            col_name = col_info['name']
            col_type = col_info['type']
            columns_desc.append(f"  - {col_name} ({col_type})")

        columns_text = "\n".join(columns_desc)

        # Build sample data text if available
        sample_text = ""
        if sample_data and len(sample_data) > 0:
            sample_text = "\n\nSample Data (first few rows):\n"
            sample_text += self._format_sample_data(sample_data[:3])

        prompt = f"""Convert the following natural language question into a SQLite query.

Database Information:
Table Name: {table_name}

Columns:
{columns_text}
{sample_text}

Question: {question}

Important Instructions:
1. Return ONLY the SQL query, nothing else
2. Use SQLite syntax
3. Use proper column names from the schema
4. Ensure the query is safe (SELECT only, no DROP/DELETE/UPDATE)
5. Handle case-insensitive searches with LOWER() if needed
6. Use appropriate WHERE clauses and conditions
7. Do not include any markdown formatting or explanations

SQL Query:"""

        return prompt

    def _format_sample_data(self, sample_data: List[Dict[str, Any]]) -> str:
        """Format sample data for prompt"""
        if not sample_data:
            return ""

        # Get column names
        columns = list(sample_data[0].keys())

        # Build table
        result = "| " + " | ".join(columns) + " |\n"
        result += "|" + "|".join(["---" for _ in columns]) + "|\n"

        for row in sample_data:
            values = [str(row.get(col, ''))[:30] for col in columns]  # Limit length
            result += "| " + " | ".join(values) + " |\n"

        return result

    def _clean_sql_response(self, sql: str) -> str:
        """
        Clean up SQL response from LLM

        Args:
            sql: Raw SQL from LLM

        Returns:
            Cleaned SQL query
        """
        # Remove markdown code blocks
        sql = sql.replace("```sql", "").replace("```", "")

        # Remove common prefixes
        prefixes = ["SQL Query:", "Query:", "sql:", "SQL:"]
        for prefix in prefixes:
            if sql.strip().startswith(prefix):
                sql = sql.strip()[len(prefix):].strip()

        # Remove trailing semicolons (we'll add them if needed)
        sql = sql.rstrip(';').strip()

        return sql

    def validate_response(self, sql: str) -> bool:
        """
        Validate that LLM response is a valid SQL query

        Args:
            sql: SQL query string

        Returns:
            True if valid, False otherwise
        """
        if not sql:
            return False

        # Must start with SELECT (we only allow read queries)
        if not sql.strip().upper().startswith('SELECT'):
            return False

        # Basic syntax check
        if 'FROM' not in sql.upper():
            return False

        return True
