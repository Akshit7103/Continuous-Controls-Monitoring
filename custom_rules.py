"""
Custom Rules Module - LLM-powered user-defined breach rules
Stores rules in aim_workflow.db. Generates SQL WHERE clauses from natural
language, validates for safety, and evaluates against scenario DataFrames
using an in-memory SQLite engine.
"""

import os
import re
import json
import sqlite3
import pandas as pd
from typing import Optional

from auth_db import list_custom_rules

# ── Safety validation ─────────────────────────────────────────────────────

FORBIDDEN_KEYWORDS = [
    'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE',
    'REPLACE', 'RENAME', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK',
    'EXEC', 'EXECUTE', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM',
]

INJECTION_PATTERNS = [
    r';',        # Statement terminator — no multi-statements allowed
    r'--',       # SQL line comment
    r'/\*',      # SQL block comment
    r'\bUNION\b',
]


def validate_sql_where(sql_where: str) -> tuple[bool, str]:
    """Validate a SQL WHERE expression for safety.

    Returns (is_valid, error_message). The expression must contain no
    forbidden keywords, no statement terminators, no comments, and no
    UNION. It will be embedded as the argument of a SELECT ... WHERE clause.
    """
    if not sql_where or not sql_where.strip():
        return False, "Empty WHERE clause"

    expr_upper = sql_where.upper()

    for kw in FORBIDDEN_KEYWORDS:
        if re.search(r'\b' + kw + r'\b', expr_upper):
            return False, f"Forbidden keyword in expression: {kw}"

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, expr_upper):
            return False, "Unsafe pattern detected in expression"

    return True, ""


def _clean_sql_where(sql_where: str) -> str:
    """Strip markdown, leading 'WHERE', and trailing semicolons from raw LLM output."""
    s = sql_where.strip()
    s = s.replace("```sql", "").replace("```", "").strip()
    s = s.rstrip(';').strip()
    if s.upper().startswith('WHERE '):
        s = s[6:].strip()
    return s


# ── LLM rule generation ───────────────────────────────────────────────────

def _build_rule_prompt(
    nl_description: str,
    scenario_name: str,
    columns: list[dict],
    sample_rows: list[dict],
) -> str:
    """Build the user prompt for the rule-generation LLM call."""
    cols_text = "\n".join(
        f"  - {c['name']} ({c.get('type', 'unknown')})" for c in columns
    )

    sample_text = ""
    if sample_rows:
        header = list(sample_rows[0].keys())
        sample_text = "\nSample rows (first few):\n"
        sample_text += "| " + " | ".join(header) + " |\n"
        sample_text += "|" + "|".join(["---"] * len(header)) + "|\n"
        for row in sample_rows[:3]:
            sample_text += (
                "| " + " | ".join(str(row.get(k, ''))[:40] for k in header) + " |\n"
            )

    return f"""You write SQLite WHERE-clause expressions for a bank compliance breach-detection tool.

Scenario: {scenario_name}
Columns available in the scenario table:
{cols_text}
{sample_text}

User wants to flag rows as a breach when:
\"\"\"{nl_description}\"\"\"

Your task: produce a JSON object with exactly two keys:
  - "sql_where": a SQLite boolean expression using ONLY columns listed above.
    The expression is placed after WHERE in `SELECT * FROM scenario WHERE <expr>`.
    Do NOT include the WHERE keyword itself.
    Do NOT write a full query or a subquery referencing other tables.
    Do NOT use DDL, DML, UNION, or PRAGMA. Only a boolean filter expression.
    For dates, use `date(col)` / `datetime(col)` helpers where needed.
    For case-insensitive text, use LOWER(col).
  - "breach_reason": a short (< 80 chars) human-readable reason describing the
    breach. This goes into a Breach_Reason column.

Return ONLY a JSON object. No markdown, no explanation.
"""


def generate_rule_from_nl(
    nl_description: str,
    scenario_name: str,
    columns: list[dict],
    sample_rows: list[dict] = None,
) -> dict:
    """Call the LLM to generate a SQL WHERE clause and breach reason.

    Returns {'sql_where': str, 'breach_reason': str}.
    Raises ValueError on bad input, RuntimeError on LLM failure.
    """
    if not nl_description or not nl_description.strip():
        raise ValueError("Description is required")
    if not columns:
        raise ValueError("Scenario columns are required")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    prompt = _build_rule_prompt(
        nl_description, scenario_name, columns, sample_rows or []
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a SQL expert generating safe SQLite WHERE "
                        "expressions for breach detection. Output JSON only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
    except Exception as e:
        raise RuntimeError(f"LLM call failed: {e}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"LLM did not return valid JSON: {raw[:200]}")

    sql_where = _clean_sql_where(parsed.get("sql_where", ""))
    breach_reason = (parsed.get("breach_reason") or "").strip()[:200]

    if not sql_where:
        raise RuntimeError("LLM did not produce a SQL WHERE clause")
    if not breach_reason:
        breach_reason = f"Custom rule: {nl_description[:60]}"

    ok, msg = validate_sql_where(sql_where)
    if not ok:
        raise RuntimeError(f"Generated expression rejected: {msg}")

    return {"sql_where": sql_where, "breach_reason": breach_reason}


# ── Execution against a DataFrame ─────────────────────────────────────────

_TABLE_NAME = "scenario"
_ROW_IDX_COL = "__ccm_row_idx__"


def evaluate_where_on_df(df: pd.DataFrame, sql_where: str) -> tuple[pd.Series, int, str]:
    """Evaluate a SQL WHERE expression against a DataFrame using in-memory SQLite.

    Returns (boolean_mask, matched_count, error_message).
    If error_message is non-empty the mask is all-False.
    """
    empty_mask = pd.Series(False, index=df.index)

    ok, msg = validate_sql_where(sql_where)
    if not ok:
        return empty_mask, 0, msg

    if df is None or len(df) == 0:
        return empty_mask, 0, ""

    try:
        work = df.copy()
        # Use a dedicated row-index column so we can map matches back
        work[_ROW_IDX_COL] = range(len(work))

        # Coerce datetime columns to string so SQLite's date/datetime funcs work
        for col in work.columns:
            if pd.api.types.is_datetime64_any_dtype(work[col]):
                work[col] = work[col].astype(str)

        conn = sqlite3.connect(":memory:")
        try:
            work.to_sql(_TABLE_NAME, conn, index=False, if_exists="replace")
            query = (
                f"SELECT {_ROW_IDX_COL} FROM {_TABLE_NAME} WHERE {sql_where}"
            )
            cur = conn.execute(query)
            matched_positions = {row[0] for row in cur.fetchall()}
        finally:
            conn.close()
    except Exception as e:
        return empty_mask, 0, f"Execution error: {e}"

    positions = pd.Series(range(len(df)), index=df.index)
    mask = positions.isin(matched_positions)
    return mask, int(mask.sum()), ""


def apply_custom_rules_to_scenario(
    scenario_name: str,
    df: pd.DataFrame,
) -> pd.DataFrame:
    """Apply all active custom rules for a scenario to its DataFrame.

    Mutates and returns df. Rows that match a custom rule are marked with
    Breach_Flag='Yes'. If a row was not already flagged, its Breach_Reason
    becomes `[Custom:<rule_name>] <reason>`. Existing breach reasons are
    preserved (hardcoded rules take priority in messaging).
    """
    if df is None or len(df) == 0:
        return df

    rules = list_custom_rules(scenario_name=scenario_name, active_only=True)
    if not rules:
        return df

    if "Breach_Flag" not in df.columns:
        df["Breach_Flag"] = "No"
    if "Breach_Reason" not in df.columns:
        df["Breach_Reason"] = ""

    for rule in rules:
        mask, _count, err = evaluate_where_on_df(df, rule["sql_where"])
        if err:
            print(f"[WARN] Custom rule '{rule['rule_name']}' on "
                  f"'{scenario_name}' skipped: {err}")
            continue
        mask = mask.fillna(False)
        if not mask.any():
            continue
        # Rows matched by this custom rule that were NOT already breaching
        newly_flagged = mask & (df["Breach_Flag"] != "Yes")
        reason_text = f"[Custom:{rule['rule_name']}] {rule['breach_reason']}"
        df.loc[newly_flagged, "Breach_Reason"] = reason_text
        df.loc[mask, "Breach_Flag"] = "Yes"

    return df
