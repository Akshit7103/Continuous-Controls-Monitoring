"""
AIM Dashboard - Authentication & Workflow Database Layer
SQLite-based persistence for users, assignments, comments, and documents.
"""

import sqlite3
import os
import json
import hashlib
import secrets
import warnings
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.environ.get("AIM_DATA_DIR", BASE_DIR))
DB_PATH = os.path.abspath(
    os.environ.get("AIM_DB_PATH", os.path.join(DATA_DIR, "aim_workflow.db"))
)
UPLOADS_DIR = os.path.abspath(
    os.environ.get("AIM_UPLOADS_DIR", os.path.join(DATA_DIR, "uploads"))
)


def _get_conn():
    """Get a SQLite connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _hash_password(password: str, salt: str = None) -> tuple[str, str]:
    """Hash password with salt using SHA-256. Returns (hash, salt)."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return hashed, salt


def init_db():
    """Initialize database tables and seed default admin. Safe to call repeatedly."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)

    conn = _get_conn()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'reviewer')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_name TEXT NOT NULL,
            category TEXT NOT NULL,
            assigned_to INTEGER NOT NULL REFERENCES users(id),
            assigned_by INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL DEFAULT 'Pending'
                CHECK(status IN ('Pending', 'In Review', 'Resolved')),
            breach_count INTEGER NOT NULL DEFAULT 0,
            record_indices TEXT,
            notes TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            comment_text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id),
            uploaded_by INTEGER NOT NULL REFERENCES users(id),
            filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            file_type TEXT,
            file_size INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS custom_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_name TEXT NOT NULL,
            category TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            nl_description TEXT NOT NULL,
            sql_where TEXT NOT NULL,
            breach_reason TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_custom_rules_scenario
            ON custom_rules(scenario_name, is_active);
    """)

    admin_username = os.environ.get("AIM_ADMIN_USERNAME", "admin").strip() or "admin"
    admin_display_name = (
        os.environ.get("AIM_ADMIN_DISPLAY_NAME", "Administrator").strip()
        or "Administrator"
    )
    admin_password = os.environ.get("AIM_ADMIN_PASSWORD")
    is_production = (
        os.environ.get("AIM_ENV", "").lower() == "production"
        or os.environ.get("RENDER") is not None
    )

    if not admin_password:
        if is_production:
            conn.close()
            raise RuntimeError(
                "AIM_ADMIN_PASSWORD must be set in production before the app can start."
            )
        admin_password = "admin"
        warnings.warn(
            "AIM_ADMIN_PASSWORD is not set; using the local-development password "
            "'admin'. Never use this fallback in production.",
            stacklevel=1,
        )

    # Seed the administrator or rotate its password to the configured secret.
    existing = cursor.execute(
        "SELECT id, password_hash, password_salt FROM users WHERE username = ?",
        (admin_username,),
    ).fetchone()

    if not existing:
        pw_hash, pw_salt = _hash_password(admin_password)
        cursor.execute(
            "INSERT INTO users (username, password_hash, password_salt, display_name, role) "
            "VALUES (?, ?, ?, ?, ?)",
            (admin_username, pw_hash, pw_salt, admin_display_name, "admin"),
        )
    else:
        configured_hash, _ = _hash_password(admin_password, existing["password_salt"])
        if configured_hash != existing["password_hash"]:
            pw_hash, pw_salt = _hash_password(admin_password)
            cursor.execute(
                "UPDATE users SET password_hash = ?, password_salt = ?, "
                "display_name = ?, role = 'admin', is_active = 1 WHERE id = ?",
                (pw_hash, pw_salt, admin_display_name, existing["id"]),
            )

    conn.commit()
    conn.close()


# ── User functions ────────────────────────────────────────────────────────


def verify_user(username: str, password: str) -> dict | None:
    """Verify credentials. Returns user dict or None."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)
    ).fetchone()
    conn.close()

    if not row:
        return None

    pw_hash, _ = _hash_password(password, row["password_salt"])
    if pw_hash != row["password_hash"]:
        return None

    return dict(row)


def create_user(username: str, password: str, display_name: str, role: str) -> bool:
    """Create a new user. Returns True on success, False if username exists."""
    pw_hash, pw_salt = _hash_password(password)
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, password_salt, display_name, role) "
            "VALUES (?, ?, ?, ?, ?)",
            (username, pw_hash, pw_salt, display_name, role),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def list_users(role: str = None, active_only: bool = True) -> list[dict]:
    """List users, optionally filtered by role."""
    conn = _get_conn()
    query = "SELECT id, username, display_name, role, created_at, is_active FROM users WHERE 1=1"
    params = []
    if role:
        query += " AND role = ?"
        params.append(role)
    if active_only:
        query += " AND is_active = 1"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def toggle_user_active(user_id: int, is_active: bool):
    """Enable or disable a user."""
    conn = _get_conn()
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (int(is_active), user_id))
    conn.commit()
    conn.close()


# ── Assignment functions ──────────────────────────────────────────────────


def create_assignment(
    scenario_name: str,
    category: str,
    assigned_to: int,
    assigned_by: int,
    breach_count: int = 0,
    record_indices: str = "[]",
    notes: str = "",
) -> int:
    """Create an assignment. record_indices is a JSON string of row indices. Returns the new assignment ID."""
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO assignments (scenario_name, category, assigned_to, assigned_by, "
        "breach_count, record_indices, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (scenario_name, category, assigned_to, assigned_by, breach_count, record_indices, notes),
    )
    assignment_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return assignment_id


def get_assignments(
    assigned_to: int = None,
    status: str = None,
    category: str = None,
) -> list[dict]:
    """Get assignments with optional filters. Includes assignee/assigner names."""
    conn = _get_conn()
    query = """
        SELECT a.*,
               u1.display_name AS assignee_name,
               u1.username AS assignee_username,
               u2.display_name AS assigner_name
        FROM assignments a
        JOIN users u1 ON a.assigned_to = u1.id
        JOIN users u2 ON a.assigned_by = u2.id
        WHERE 1=1
    """
    params = []
    if assigned_to is not None:
        query += " AND a.assigned_to = ?"
        params.append(assigned_to)
    if status:
        query += " AND a.status = ?"
        params.append(status)
    if category:
        query += " AND a.category = ?"
        params.append(category)
    query += " ORDER BY a.created_at DESC"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_assignment_status(assignment_id: int, status: str):
    """Update assignment status and timestamp."""
    conn = _get_conn()
    conn.execute(
        "UPDATE assignments SET status = ?, updated_at = datetime('now') WHERE id = ?",
        (status, assignment_id),
    )
    conn.commit()
    conn.close()


def mark_assignment_read(assignment_id: int):
    """Mark an assignment as read by the reviewer."""
    conn = _get_conn()
    conn.execute("UPDATE assignments SET is_read = 1 WHERE id = ?", (assignment_id,))
    conn.commit()
    conn.close()


def get_unread_count(user_id: int) -> int:
    """Get count of unread assignments for a user."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT COUNT(*) as cnt FROM assignments WHERE assigned_to = ? AND is_read = 0",
        (user_id,),
    ).fetchone()
    conn.close()
    return row["cnt"] if row else 0


def find_duplicate_indices(scenario_name: str, record_indices: list[int]) -> list[dict]:
    """Check if any of the given record indices are already assigned for a scenario.
    Returns list of dicts with assignment info for overlapping indices."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT a.id, a.record_indices, a.status,
                  u.display_name AS assignee_name, u.username AS assignee_username
           FROM assignments a
           JOIN users u ON a.assigned_to = u.id
           WHERE a.scenario_name = ? AND a.record_indices IS NOT NULL""",
        (scenario_name,),
    ).fetchall()
    conn.close()

    overlaps = []
    check_set = set(record_indices)
    for r in rows:
        existing = set(json.loads(r["record_indices"]))
        common = check_set & existing
        if common:
            overlaps.append({
                "assignment_id": r["id"],
                "status": r["status"],
                "assignee_name": r["assignee_name"],
                "assignee_username": r["assignee_username"],
                "overlapping_count": len(common),
                "overlapping_indices": sorted(common),
            })
    return overlaps


def delete_assignment(assignment_id: int):
    """Delete an assignment and its related comments and documents (cascade)."""
    conn = _get_conn()
    # Get document paths to clean up files
    docs = conn.execute(
        "SELECT stored_path FROM documents WHERE assignment_id = ?", (assignment_id,)
    ).fetchall()
    for doc in docs:
        try:
            os.remove(doc["stored_path"])
        except OSError:
            pass
    # Delete in order: documents, comments, then assignment
    conn.execute("DELETE FROM documents WHERE assignment_id = ?", (assignment_id,))
    conn.execute("DELETE FROM comments WHERE assignment_id = ?", (assignment_id,))
    conn.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
    conn.commit()
    conn.close()


# ── Comment functions ─────────────────────────────────────────────────────


def add_comment(assignment_id: int, user_id: int, comment_text: str) -> int:
    """Add a comment to an assignment. Returns comment ID."""
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO comments (assignment_id, user_id, comment_text) VALUES (?, ?, ?)",
        (assignment_id, user_id, comment_text),
    )
    comment_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return comment_id


def get_comments(assignment_id: int) -> list[dict]:
    """Get all comments for an assignment with user info."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT c.*, u.display_name, u.username
           FROM comments c JOIN users u ON c.user_id = u.id
           WHERE c.assignment_id = ?
           ORDER BY c.created_at ASC""",
        (assignment_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Document functions ────────────────────────────────────────────────────


def save_document(
    assignment_id: int, uploaded_by: int, filename: str, file_data: bytes, file_type: str
) -> int:
    """Save an uploaded document to disk and database. Returns document ID."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stored_name = f"{assignment_id}_{timestamp}_{filename}"
    stored_path = os.path.join(UPLOADS_DIR, stored_name)

    with open(stored_path, "wb") as f:
        f.write(file_data)

    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO documents (assignment_id, uploaded_by, filename, stored_path, "
        "file_type, file_size) VALUES (?, ?, ?, ?, ?, ?)",
        (assignment_id, uploaded_by, filename, stored_path, file_type, len(file_data)),
    )
    doc_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return doc_id


def get_documents(assignment_id: int) -> list[dict]:
    """Get all documents for an assignment."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT d.*, u.display_name
           FROM documents d JOIN users u ON d.uploaded_by = u.id
           WHERE d.assignment_id = ?
           ORDER BY d.created_at DESC""",
        (assignment_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Custom rule functions ─────────────────────────────────────────────────

def create_custom_rule(
    scenario_name: str,
    category: str,
    rule_name: str,
    nl_description: str,
    sql_where: str,
    breach_reason: str,
    created_by: int,
    is_active: bool = True,
) -> int:
    """Insert a new custom rule. Returns the new rule ID."""
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO custom_rules
           (scenario_name, category, rule_name, nl_description, sql_where,
            breach_reason, is_active, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (scenario_name, category, rule_name, nl_description, sql_where,
         breach_reason, int(is_active), created_by),
    )
    rule_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return rule_id


def list_custom_rules(
    scenario_name: str = None,
    active_only: bool = False,
) -> list[dict]:
    """List custom rules, optionally filtered by scenario and active status."""
    conn = _get_conn()
    query = """SELECT r.*, u.display_name AS creator_name, u.username AS creator_username
               FROM custom_rules r
               LEFT JOIN users u ON r.created_by = u.id
               WHERE 1=1"""
    params = []
    if scenario_name:
        query += " AND r.scenario_name = ?"
        params.append(scenario_name)
    if active_only:
        query += " AND r.is_active = 1"
    query += " ORDER BY r.scenario_name ASC, r.created_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_custom_rule(rule_id: int) -> dict | None:
    """Fetch a single custom rule by ID."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM custom_rules WHERE id = ?", (rule_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_custom_rule(
    rule_id: int,
    rule_name: str = None,
    nl_description: str = None,
    sql_where: str = None,
    breach_reason: str = None,
    is_active: bool = None,
) -> bool:
    """Update one or more fields of a custom rule."""
    sets = []
    values = []
    if rule_name is not None:
        sets.append("rule_name = ?"); values.append(rule_name)
    if nl_description is not None:
        sets.append("nl_description = ?"); values.append(nl_description)
    if sql_where is not None:
        sets.append("sql_where = ?"); values.append(sql_where)
    if breach_reason is not None:
        sets.append("breach_reason = ?"); values.append(breach_reason)
    if is_active is not None:
        sets.append("is_active = ?"); values.append(int(is_active))
    if not sets:
        return False
    sets.append("updated_at = datetime('now')")
    values.append(rule_id)

    conn = _get_conn()
    cursor = conn.execute(
        f"UPDATE custom_rules SET {', '.join(sets)} WHERE id = ?", values
    )
    conn.commit()
    changed = cursor.rowcount > 0
    conn.close()
    return changed


def delete_custom_rule(rule_id: int) -> bool:
    """Delete a custom rule by ID."""
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM custom_rules WHERE id = ?", (rule_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted
