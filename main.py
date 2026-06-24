"""
AIM Dashboard v2 — FastAPI Backend
Complete REST API serving the Analytics in Motion dashboard.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Optional, List

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import (
    FastAPI, Header, HTTPException, Depends, UploadFile, File, Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from jose import jwt, JWTError
from pydantic import BaseModel

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
load_dotenv(os.path.join(PROJECT_ROOT, "SQL GPT", ".env"))

from auth_db import (
    init_db, verify_user, create_user, list_users, toggle_user_active,
    create_assignment, get_assignments, update_assignment_status,
    mark_assignment_read, delete_assignment, find_duplicate_indices,
    add_comment, get_comments, save_document, get_documents,
    create_custom_rule, list_custom_rules, get_custom_rule,
    update_custom_rule, delete_custom_rule,
)
from data_loader import (
    load_all_data, reapply_rules, get_engine_params,
    RULES_ENGINE, CATEGORY_MAP, SCENARIO_TO_CATEGORY,
    RULE_DESCRIPTIONS, HARDCODED_NO, RULE_REGISTRY,
)
from custom_rules import (
    generate_rule_from_nl, validate_sql_where, evaluate_where_on_df,
)
from pdf_report import generate_pdf_report

# ── SQL GPT integration ─────────────────────────────────────────────────────
import sys as _sys
_sql_gpt_backend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SQL GPT", "backend")
_sys.path.append(_sql_gpt_backend)

from api.upload import router as _sql_gpt_upload_router
from api.query import router as _sql_gpt_query_router
from api.download import router as _sql_gpt_download_router

# ── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="AIM Dashboard API", version="2.0")

_cors_origins = os.environ.get("AIM_CORS_ORIGINS", "http://localhost:8001").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── JWT configuration ────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get("AIM_JWT_SECRET")
_is_production = (
    os.environ.get("AIM_ENV", "").lower() == "production"
    or os.environ.get("RENDER") is not None
)
if not JWT_SECRET and _is_production:
    raise RuntimeError(
        "AIM_JWT_SECRET must be set in production before the app can start."
    )
if not JWT_SECRET:
    JWT_SECRET = "aim-dashboard-local-development-secret"
    import warnings
    warnings.warn("AIM_JWT_SECRET not set — using insecure default. Set the environment variable for production.", stacklevel=1)
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

# ── In-memory data store ─────────────────────────────────────────────────────

_user_data: dict = {}  # keyed by user_id


@app.get("/health", tags=["System"])
def health_check():
    """Lightweight endpoint used by Render health checks."""
    return {"status": "healthy", "service": "aim-dashboard"}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _clean_df(df: pd.DataFrame) -> list[dict]:
    """Serialize a DataFrame to a list of dicts, converting NaN/NaT to None."""
    # Convert datetime columns to string first
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].astype(str)
    return df.replace({np.nan: None}).to_dict(orient="records")


def _clean_value(val):
    """Convert a single value: NaN/NaT -> None."""
    if val is None:
        return None
    if isinstance(val, float) and np.isnan(val):
        return None
    if isinstance(val, pd.Timestamp) and pd.isna(val):
        return None
    return val


# ── JWT auth ─────────────────────────────────────────────────────────────────

def create_token(user_id: int, username: str, role: str, display_name: str = "") -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "display_name": display_name,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    token = authorization
    if token.lower().startswith("bearer "):
        token = token[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "id": payload["user_id"],
            "username": payload["username"],
            "role": payload["role"],
            "display_name": payload.get("display_name", payload["username"]),
        }
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")


# ── Pydantic models ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    username: str
    password: str
    display_name: str


class ParamsUpdate(BaseModel):
    params: dict


class ExceptionFilter(BaseModel):
    categories: List[str] = []
    scenarios: List[str] = []
    breach_status: List[str] = ["Yes"]


class AssignmentCreate(BaseModel):
    scenario_name: str
    category: str
    assigned_to: int
    breach_count: int = 0
    record_indices: list = []
    notes: str = ""


class StatusUpdate(BaseModel):
    status: str


class CommentCreate(BaseModel):
    text: str


class CustomRuleGenerate(BaseModel):
    scenario_name: str
    nl_description: str


class CustomRulePreview(BaseModel):
    scenario_name: str
    sql_where: str


class CustomRuleCreate(BaseModel):
    scenario_name: str
    rule_name: str
    nl_description: str
    sql_where: str
    breach_reason: str
    is_active: bool = True


class CustomRuleUpdate(BaseModel):
    rule_name: Optional[str] = None
    nl_description: Optional[str] = None
    sql_where: Optional[str] = None
    breach_reason: Optional[str] = None
    is_active: Optional[bool] = None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return user


# ══════════════════════════════════════════════════════════════════════════════
#  AUTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/login")
def auth_login(body: LoginRequest):
    user = verify_user(body.username, body.password)
    if not user:
        raise HTTPException(401, "Invalid username or password")
    token = create_token(user["id"], user["username"], user["role"], user["display_name"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
        },
    }


@app.post("/api/auth/signup")
def auth_signup(body: SignupRequest):
    ok = create_user(body.username, body.password, body.display_name, "reviewer")
    if not ok:
        raise HTTPException(409, "Username already exists")
    return {"success": True, "message": "Account created. You can now log in."}


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return user


# ══════════════════════════════════════════════════════════════════════════════
#  DATA ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/data/upload")
async def data_upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    file_bytes = await file.read()
    try:
        params, master_df, scenario_data = load_all_data(BytesIO(file_bytes))
    except Exception as e:
        raise HTTPException(400, f"Failed to process file: {e}")

    uid = user["id"]
    _user_data[uid] = {
        "master_df": master_df,
        "scenario_data": scenario_data,
        "params": dict(params),
        "original_params": dict(params),
        "compare_master": None,
        "compare_scenario_data": None,
    }

    total_records = int(master_df["Total_Records"].sum())
    total_breaches = int(master_df["Breaches"].sum())
    overall_rate = round(total_breaches / total_records * 100, 2) if total_records > 0 else 0

    return {
        "total_scenarios": len(scenario_data),
        "total_records": total_records,
        "total_breaches": total_breaches,
        "overall_rate": overall_rate,
        "filename": file.filename,
        "master": _clean_df(master_df.copy()),
    }


def _get_store(user: dict) -> dict:
    """Retrieve the data store for a user, raising 400 if no data uploaded."""
    store = _user_data.get(user["id"])
    if not store:
        raise HTTPException(400, "No data uploaded. Please upload an AIM Excel file first.")
    return store


@app.get("/api/data/summary")
def data_summary(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    master_df = store["master_df"]
    total_records = int(master_df["Total_Records"].sum())
    total_breaches = int(master_df["Breaches"].sum())
    overall_rate = round(total_breaches / total_records * 100, 2) if total_records > 0 else 0

    # Category summary
    cat_df = master_df.groupby("Category").agg(
        Records=("Total_Records", "sum"),
        Breaches=("Breaches", "sum"),
    ).reset_index()
    cat_df["Breach_Rate"] = (cat_df["Breaches"] / cat_df["Records"] * 100).round(2)
    cat_df = cat_df.sort_values("Breaches", ascending=False)

    return {
        "master": _clean_df(master_df.copy()),
        "stats": {
            "total_scenarios": len(store["scenario_data"]),
            "total_records": total_records,
            "total_breaches": total_breaches,
            "overall_rate": overall_rate,
        },
        "categories": _clean_df(cat_df),
    }


@app.get("/api/data/scenario/{name}")
def data_scenario(
    name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    sort_col: Optional[str] = Query(None),
    sort_dir: str = Query("asc", regex="^(asc|desc)$"),
    breach_filter: Optional[str] = Query(None, regex="^(Yes|No)$"),
    search: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    store = _get_store(user)
    scenario_data = store["scenario_data"]
    if name not in scenario_data:
        raise HTTPException(404, f"Scenario '{name}' not found")

    df = scenario_data[name]
    total = len(df)
    breaches = int((df["Breach_Flag"] == "Yes").sum())
    non_breaches = total - breaches
    rate = round(breaches / total * 100, 2) if total > 0 else 0

    rule_info = RULES_ENGINE.get(name, {})
    relevant_params = {k: v for k, v in store["params"].items() if k.startswith(name + "|")}

    # Pre-compute breach reason counts from full dataset (not affected by filters/pagination)
    breach_reasons = {}
    breach_df_all = df[df["Breach_Flag"] == "Yes"]
    if "Breach_Reason" in breach_df_all.columns:
        reason_counts = breach_df_all["Breach_Reason"].fillna("Unknown").value_counts()
        breach_reasons = {str(k): int(v) for k, v in reason_counts.items()}

    # Apply filters
    filtered = df.copy()
    if breach_filter:
        filtered = filtered[filtered["Breach_Flag"] == breach_filter]
    if search:
        mask = pd.Series(False, index=filtered.index)
        search_lower = search.lower()
        for col in filtered.columns:
            mask |= filtered[col].astype(str).str.lower().str.contains(search_lower, na=False)
        filtered = filtered[mask]

    filtered_total = len(filtered)

    # Sort
    if sort_col and sort_col in filtered.columns:
        ascending = sort_dir == "asc"
        filtered = filtered.sort_values(by=sort_col, ascending=ascending, na_position="last")

    # Paginate
    total_pages = max(1, (filtered_total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    page_df = filtered.iloc[start : start + page_size]

    return {
        "records": _clean_df(page_df),
        "stats": {
            "total": total,
            "breaches": breaches,
            "non_breaches": non_breaches,
            "rate": rate,
        },
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_records": filtered_total,
            "total_pages": total_pages,
        },
        "rule_info": {
            "description": rule_info.get("description", ""),
            "status": rule_info.get("status", ""),
            "thresholds": rule_info.get("thresholds", {}),
            "category": rule_info.get("category", ""),
        },
        "params": relevant_params,
        "columns": df.columns.tolist(),
        "breach_reasons": breach_reasons,
    }


@app.get("/api/data/params")
def data_params_get(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    params = store["params"]

    rules = []
    for scenario, config in RULES_ENGINE.items():
        category = config["category"]
        for param_name, default_val in config.get("thresholds", {}).items():
            key = f"{scenario}|{param_name}"
            current_val = params.get(key, default_val)
            rules.append({
                "category": category,
                "scenario": scenario,
                "parameter": param_name,
                "default_val": default_val,
                "value": current_val,
            })

    return {"params": params, "rules": rules}


@app.post("/api/data/params")
def data_params_update(body: ParamsUpdate, user: dict = Depends(get_current_user)):
    store = _get_store(user)
    old_breaches = int(store["master_df"]["Breaches"].sum())

    new_master, new_scenario_data = reapply_rules(store["scenario_data"], body.params)
    new_breaches = int(new_master["Breaches"].sum())

    store["params"] = body.params
    store["master_df"] = new_master
    store["scenario_data"] = new_scenario_data

    return {
        "old_breaches": old_breaches,
        "new_breaches": new_breaches,
        "delta": new_breaches - old_breaches,
        "master": _clean_df(new_master.copy()),
    }


@app.post("/api/data/params/reset")
def data_params_reset(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    default_params = get_engine_params()
    old_breaches = int(store["master_df"]["Breaches"].sum())

    new_master, new_scenario_data = reapply_rules(store["scenario_data"], default_params)
    new_breaches = int(new_master["Breaches"].sum())

    store["params"] = default_params
    store["original_params"] = dict(default_params)
    store["master_df"] = new_master
    store["scenario_data"] = new_scenario_data

    return {
        "old_breaches": old_breaches,
        "new_breaches": new_breaches,
        "delta": new_breaches - old_breaches,
        "master": _clean_df(new_master.copy()),
    }


@app.get("/api/data/trend")
def data_trend(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    scenario_data = store["scenario_data"]

    date_keywords = {"date", "time", "month", "year", "period", "timestamp"}
    trend_rows = []
    scenarios_with_dates = []
    scenarios_without_dates = []

    for scenario_name, df in scenario_data.items():
        category = SCENARIO_TO_CATEGORY.get(scenario_name, "Other")

        # Find best date column
        date_col = None
        for col in df.columns:
            col_lower = str(col).lower()
            if any(kw in col_lower for kw in date_keywords):
                try:
                    test = pd.to_datetime(df[col], errors="coerce")
                    valid_pct = test.notna().mean()
                    if valid_pct >= 0.5:
                        date_col = col
                        break
                except Exception:
                    continue

        # Fallback: check all columns for datetime dtype
        if date_col is None:
            for col in df.columns:
                if pd.api.types.is_datetime64_any_dtype(df[col]):
                    date_col = col
                    break

        if date_col is None:
            scenarios_without_dates.append(scenario_name)
            continue

        scenarios_with_dates.append((scenario_name, date_col))

        df_copy = df.copy()
        df_copy["_parsed_date"] = pd.to_datetime(df_copy[date_col], errors="coerce")
        df_copy = df_copy.dropna(subset=["_parsed_date"])
        # Filter out unreasonable dates (before 2000 or after 2100)
        df_copy = df_copy[
            (df_copy["_parsed_date"] >= pd.Timestamp("2000-01-01")) &
            (df_copy["_parsed_date"] <= pd.Timestamp("2100-01-01"))
        ]

        if df_copy.empty:
            scenarios_without_dates.append(scenario_name)
            continue

        df_copy["_period"] = df_copy["_parsed_date"].dt.to_period("M")

        for period, grp in df_copy.groupby("_period"):
            total = len(grp)
            breaches = int((grp["Breach_Flag"] == "Yes").sum()) if "Breach_Flag" in grp.columns else 0
            trend_rows.append({
                "Scenario": scenario_name,
                "Category": category,
                "Period": str(period),
                "Period_dt": period.to_timestamp().isoformat(),
                "Records": total,
                "Breaches": breaches,
            })

    if not trend_rows:
        return {"trend": [], "coverage": {
            "total": len(scenario_data), "covered": 0,
            "without_dates": len(scenarios_without_dates),
            "date_range_min": None, "date_range_max": None, "periods": 0,
        }, "overall": []}

    trend_df = pd.DataFrame(trend_rows)
    trend_df["Breach_Rate"] = (trend_df["Breaches"] / trend_df["Records"] * 100).round(2).fillna(0)

    # Parse Period_dt back for aggregation
    trend_df["_pdt"] = pd.to_datetime(trend_df["Period_dt"])

    date_range_min = trend_df["_pdt"].min().strftime("%b %Y")
    date_range_max = trend_df["_pdt"].max().strftime("%b %Y")
    unique_periods = sorted(trend_df["Period"].unique())

    # Overall aggregation
    overall = trend_df.groupby("_pdt").agg(
        Records=("Records", "sum"),
        Breaches=("Breaches", "sum"),
    ).reset_index().sort_values("_pdt")
    overall["Breach_Rate"] = (overall["Breaches"] / overall["Records"] * 100).round(2)
    overall["Period_Label"] = overall["_pdt"].dt.strftime("%b %Y")
    overall["Period_dt"] = overall["_pdt"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    # Drop helper columns
    trend_out = trend_df.drop(columns=["_pdt"])
    overall_out = overall.drop(columns=["_pdt"])

    return {
        "trend": _clean_df(trend_out),
        "coverage": {
            "total": len(scenario_data),
            "covered": len(scenarios_with_dates),
            "without_dates": len(scenarios_without_dates),
            "date_range_min": date_range_min,
            "date_range_max": date_range_max,
            "periods": len(unique_periods),
        },
        "overall": _clean_df(overall_out),
    }


@app.get("/api/data/causality")
def data_causality(
    id_col: str = Query("CIF_ID"),
    user: dict = Depends(get_current_user),
):
    store = _get_store(user)
    scenario_data = store["scenario_data"]

    id_col_candidates = [
        "CIF_ID", "Account_No", "Loan_ID", "Customer_ID",
        "User_ID", "Employee_ID", "Vendor_ID", "Branch_ID",
        "PAN", "Employee_PAN", "App_ID", "Nostro_Account",
    ]

    id_col_to_scenarios: dict[str, list] = {}
    breach_index: dict[tuple, set] = {}

    for scenario_name, df in scenario_data.items():
        if "Breach_Flag" not in df.columns:
            continue
        breach_df = df[df["Breach_Flag"] == "Yes"]
        if breach_df.empty:
            continue
        for ic in id_col_candidates:
            if ic in df.columns:
                if ic not in id_col_to_scenarios:
                    id_col_to_scenarios[ic] = []
                id_col_to_scenarios[ic].append(scenario_name)
                ids = set(breach_df[ic].dropna().astype(str))
                breach_index[(ic, scenario_name)] = ids

    # Keep only ID columns that link 2+ scenarios
    linkable = {col: scns for col, scns in id_col_to_scenarios.items() if len(scns) >= 2}

    linkable_cols = [{"col": col, "scenario_count": len(scns)} for col, scns in linkable.items()]
    linkable_cols.sort(key=lambda x: x["scenario_count"], reverse=True)

    if not linkable or id_col not in linkable:
        # Return empty structure
        total_linkable = len(linkable)
        total_linked = len(set(s for scns in linkable.values() for s in scns))
        total_entities = len(set(
            eid for (col, scn), ids in breach_index.items() for eid in ids if col in linkable
        ))
        return {
            "linkable_cols": linkable_cols,
            "linked_scenarios": [],
            "matrix": {"index": [], "columns": [], "data": []},
            "pairs": [],
            "offenders": [],
            "influence": [],
            "cat_pairs": [],
            "stats": {
                "total_linkable": total_linkable,
                "total_linked": total_linked,
                "total_entities": total_entities,
            },
        }

    selected_id_col = id_col
    linked_scenarios = linkable[selected_id_col]

    total_linkable = len(linkable)
    total_linked = len(set(s for scns in linkable.values() for s in scns))
    total_entities = len(set(
        eid for (col, scn), ids in breach_index.items() for eid in ids if col in linkable
    ))

    # Co-occurrence matrix
    n = len(linked_scenarios)
    cooccur_matrix = pd.DataFrame(0, index=linked_scenarios, columns=linked_scenarios)
    for i, s1 in enumerate(linked_scenarios):
        ids1 = breach_index.get((selected_id_col, s1), set())
        cooccur_matrix.loc[s1, s1] = len(ids1)
        for j, s2 in enumerate(linked_scenarios):
            if j <= i:
                continue
            ids2 = breach_index.get((selected_id_col, s2), set())
            overlap = len(ids1 & ids2)
            cooccur_matrix.loc[s1, s2] = overlap
            cooccur_matrix.loc[s2, s1] = overlap

    matrix_data = {
        "index": cooccur_matrix.index.tolist(),
        "columns": cooccur_matrix.columns.tolist(),
        "data": cooccur_matrix.values.tolist(),
    }

    # Pairs with Jaccard
    pairs = []
    for i, s1 in enumerate(linked_scenarios):
        ids1 = breach_index.get((selected_id_col, s1), set())
        if not ids1:
            continue
        for j, s2 in enumerate(linked_scenarios):
            if j <= i:
                continue
            ids2 = breach_index.get((selected_id_col, s2), set())
            if not ids2:
                continue
            overlap = len(ids1 & ids2)
            if overlap == 0:
                continue
            union = len(ids1 | ids2)
            jaccard = round(overlap / union * 100, 1) if union > 0 else 0
            cond_a_b = round(overlap / len(ids1) * 100, 1) if ids1 else 0
            cond_b_a = round(overlap / len(ids2) * 100, 1) if ids2 else 0
            pairs.append({
                "Scenario A": s1,
                "Scenario B": s2,
                "Shared Breaches": overlap,
                "A Breaches": len(ids1),
                "B Breaches": len(ids2),
                "A_to_B_pct": cond_a_b,
                "B_to_A_pct": cond_b_a,
                "Jaccard_pct": jaccard,
            })
    pairs.sort(key=lambda x: x["Shared Breaches"], reverse=True)

    # Repeat offenders
    entity_scenarios: dict[str, list] = {}
    for scn in linked_scenarios:
        ids = breach_index.get((selected_id_col, scn), set())
        for eid in ids:
            if eid not in entity_scenarios:
                entity_scenarios[eid] = []
            entity_scenarios[eid].append(scn)

    offenders = []
    for eid, scns in entity_scenarios.items():
        if len(scns) >= 2:
            offenders.append({
                "entity_id": eid,
                "breached_scenarios": len(scns),
                "scenarios": sorted(scns),
                "categories": sorted(set(SCENARIO_TO_CATEGORY.get(s, "Other") for s in scns)),
            })
    offenders.sort(key=lambda x: x["breached_scenarios"], reverse=True)

    # Influence scores
    influence_map: dict[str, dict] = {}
    if pairs:
        pairs_df = pd.DataFrame(pairs)
        for _, row in pairs_df.iterrows():
            s1, s2 = row["Scenario A"], row["Scenario B"]
            shared = row["Shared Breaches"]
            for s, other in [(s1, s2), (s2, s1)]:
                if s not in influence_map:
                    influence_map[s] = {"total_influence": 0, "linked_count": 0, "scenarios": []}
                influence_map[s]["total_influence"] += shared
                influence_map[s]["linked_count"] += 1
                influence_map[s]["scenarios"].append(other)

    influence = []
    for scn, data in influence_map.items():
        own_breaches = len(breach_index.get((selected_id_col, scn), set()))
        influence.append({
            "Scenario": scn,
            "Category": SCENARIO_TO_CATEGORY.get(scn, "Other"),
            "Own Breaches": own_breaches,
            "Linked Scenarios": data["linked_count"],
            "Total Shared Breaches": data["total_influence"],
            "Influence Score": round(
                data["total_influence"] * data["linked_count"] / max(own_breaches, 1), 1
            ),
            "Connected To": sorted(data["scenarios"])[:5],
        })
    influence.sort(key=lambda x: x["Influence Score"], reverse=True)

    # Category chain analysis
    cat_ids: dict[str, set] = {}
    for scn in linked_scenarios:
        cat = SCENARIO_TO_CATEGORY.get(scn, "Other")
        ids = breach_index.get((selected_id_col, scn), set())
        if cat not in cat_ids:
            cat_ids[cat] = set()
        cat_ids[cat] |= ids

    cat_names = sorted(cat_ids.keys())
    cat_pairs = []
    if len(cat_names) >= 2:
        for i, c1 in enumerate(cat_names):
            for j, c2 in enumerate(cat_names):
                if j <= i:
                    continue
                overlap = len(cat_ids[c1] & cat_ids[c2])
                if overlap == 0:
                    continue
                total_c1 = len(cat_ids[c1])
                total_c2 = len(cat_ids[c2])
                cat_pairs.append({
                    "Category A": c1,
                    "Category B": c2,
                    "Shared Entities": overlap,
                    "A Total": total_c1,
                    "B Total": total_c2,
                    "A_to_B_pct": round(overlap / total_c1 * 100, 1) if total_c1 else 0,
                    "B_to_A_pct": round(overlap / total_c2 * 100, 1) if total_c2 else 0,
                })
        cat_pairs.sort(key=lambda x: x["Shared Entities"], reverse=True)

    return {
        "linkable_cols": linkable_cols,
        "linked_scenarios": linked_scenarios,
        "matrix": matrix_data,
        "pairs": pairs,
        "offenders": offenders,
        "influence": influence,
        "cat_pairs": cat_pairs,
        "stats": {
            "total_linkable": total_linkable,
            "total_linked": total_linked,
            "total_entities": total_entities,
        },
    }


@app.get("/api/data/breached-scenarios")
def data_breached_scenarios(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    master_df = store["master_df"]
    breached = master_df[master_df["Breaches"] > 0].copy()
    scenarios = []
    for _, row in breached.iterrows():
        scenarios.append({
            "scenario": row["Scenario"],
            "category": row["Category"],
            "breaches": int(row["Breaches"]),
            "total_records": int(row["Total_Records"]),
            "rate": float(row["Breach_Rate"]),
        })
    return {"scenarios": scenarios}


@app.get("/api/data/breach-records/{name}")
def data_breach_records(name: str, user: dict = Depends(get_current_user)):
    store = _get_store(user)
    scenario_data = store["scenario_data"]
    if name not in scenario_data:
        raise HTTPException(404, f"Scenario '{name}' not found")
    df = scenario_data[name]
    breach_df = df[df["Breach_Flag"] == "Yes"].copy()
    return {
        "records": _clean_df(breach_df),
        "columns": breach_df.columns.tolist(),
    }


@app.post("/api/data/comparison/upload")
async def data_comparison_upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    store = _get_store(user)
    file_bytes = await file.read()
    try:
        _, compare_master, compare_scenario_data = load_all_data(BytesIO(file_bytes))
    except Exception as e:
        raise HTTPException(400, f"Failed to process comparison file: {e}")

    store["compare_master"] = compare_master
    store["compare_scenario_data"] = compare_scenario_data

    total_records = int(compare_master["Total_Records"].sum())
    total_breaches = int(compare_master["Breaches"].sum())
    overall_rate = round(total_breaches / total_records * 100, 2) if total_records > 0 else 0

    return {
        "total_scenarios": len(compare_scenario_data),
        "total_records": total_records,
        "total_breaches": total_breaches,
        "overall_rate": overall_rate,
        "filename": file.filename,
    }


@app.get("/api/data/comparison")
def data_comparison(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    compare_master = store.get("compare_master")
    if compare_master is None:
        raise HTTPException(400, "No comparison file uploaded")

    current_master = store["master_df"].copy()

    # Overall KPIs
    curr_records = int(current_master["Total_Records"].sum())
    curr_breaches = int(current_master["Breaches"].sum())
    curr_rate = round(curr_breaches / curr_records * 100, 2) if curr_records > 0 else 0

    comp_records = int(compare_master["Total_Records"].sum())
    comp_breaches = int(compare_master["Breaches"].sum())
    comp_rate = round(comp_breaches / comp_records * 100, 2) if comp_records > 0 else 0

    d_records = curr_records - comp_records
    d_breaches = curr_breaches - comp_breaches
    d_rate = round(curr_rate - comp_rate, 2)

    # Scenario-level merge
    curr_df = current_master[["Scenario", "Category", "Total_Records", "Breaches", "Breach_Rate"]].copy()
    curr_df.columns = ["Scenario", "Category", "Records_Current", "Breaches_Current", "Rate_Current"]

    comp_df = compare_master[["Scenario", "Category", "Total_Records", "Breaches", "Breach_Rate"]].copy()
    comp_df.columns = ["Scenario", "Category", "Records_Comparison", "Breaches_Comparison", "Rate_Comparison"]

    merged = pd.merge(curr_df, comp_df, on=["Scenario", "Category"], how="outer", indicator=True)

    for col in ["Records_Current", "Breaches_Current", "Rate_Current"]:
        merged[col] = merged[col].fillna(0)
    for col in ["Records_Comparison", "Breaches_Comparison", "Rate_Comparison"]:
        merged[col] = merged[col].fillna(0)

    merged["Breaches_Delta"] = merged["Breaches_Current"] - merged["Breaches_Comparison"]
    merged["Rate_Delta"] = (merged["Rate_Current"] - merged["Rate_Comparison"]).round(2)

    def _change_status(row):
        if row["_merge"] == "left_only":
            return "New Scenario"
        elif row["_merge"] == "right_only":
            return "Removed Scenario"
        elif row["Breaches_Delta"] > 0:
            return "Worsened"
        elif row["Breaches_Delta"] < 0:
            return "Improved"
        return "No Change"

    merged["Status"] = merged.apply(_change_status, axis=1)
    merged = merged.drop(columns=["_merge"])

    # Category-level comparison
    curr_cat = current_master.groupby("Category").agg(
        Breaches_Current=("Breaches", "sum"),
        Rate_Current=("Breach_Rate", "mean"),
    ).round(2)
    comp_cat = compare_master.groupby("Category").agg(
        Breaches_Comparison=("Breaches", "sum"),
        Rate_Comparison=("Breach_Rate", "mean"),
    ).round(2)
    cat_merged = pd.merge(curr_cat, comp_cat, left_index=True, right_index=True, how="outer").fillna(0)
    cat_merged["Breaches_Delta"] = (cat_merged["Breaches_Current"] - cat_merged["Breaches_Comparison"]).astype(int)
    cat_merged["Rate_Delta"] = (cat_merged["Rate_Current"] - cat_merged["Rate_Comparison"]).round(2)
    cat_merged = cat_merged.reset_index().sort_values("Breaches_Delta", ascending=False)

    # Status counts
    status_counts = merged["Status"].value_counts().to_dict()

    return {
        "merged": _clean_df(merged),
        "cat_comparison": _clean_df(cat_merged),
        "summary": {
            "curr_records": curr_records,
            "curr_breaches": curr_breaches,
            "curr_rate": curr_rate,
            "comp_records": comp_records,
            "comp_breaches": comp_breaches,
            "comp_rate": comp_rate,
            "d_records": d_records,
            "d_breaches": d_breaches,
            "d_rate": d_rate,
        },
        "status_counts": status_counts,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  REPORT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/reports/pdf")
def reports_pdf(user: dict = Depends(get_current_user)):
    store = _get_store(user)
    buf = generate_pdf_report(
        store["master_df"], store["params"], store["scenario_data"], RULES_ENGINE
    )
    filename = f"AIM_Report_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_exception_df(store: dict, categories: list, scenarios: list, breach_status: list) -> pd.DataFrame:
    """Build filtered exception report DataFrame."""
    scenario_data = store["scenario_data"]
    all_categories = categories if categories else sorted(CATEGORY_MAP.keys())
    available_scenarios = scenarios if scenarios else sorted(scenario_data.keys())

    frames = []
    for scenario in available_scenarios:
        cat = SCENARIO_TO_CATEGORY.get(scenario, "Other")
        if cat not in all_categories:
            continue
        if scenario not in scenario_data:
            continue
        df = scenario_data[scenario].copy()
        if "Scenario" in df.columns:
            df["Scenario"] = scenario
        else:
            df.insert(0, "Scenario", scenario)
        if "Category" in df.columns:
            df["Category"] = cat
        else:
            df.insert(1, "Category", cat)
        frames.append(df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    if breach_status:
        combined = combined[combined["Breach_Flag"].isin(breach_status)]
    return combined


@app.post("/api/reports/exception")
def reports_exception(body: ExceptionFilter, user: dict = Depends(get_current_user)):
    store = _get_store(user)
    combined = _build_exception_df(store, body.categories, body.scenarios, body.breach_status)
    return {
        "records": _clean_df(combined),
        "total": len(combined),
        "columns": combined.columns.tolist() if not combined.empty else [],
    }


@app.get("/api/reports/exception/csv")
def reports_exception_csv(
    categories: str = Query(""),
    scenarios: str = Query(""),
    breach_status: str = Query("Yes"),
    user: dict = Depends(get_current_user),
):
    store = _get_store(user)
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    scn_list = [s.strip() for s in scenarios.split(",") if s.strip()] if scenarios else []
    breach_list = [b.strip() for b in breach_status.split(",") if b.strip()]

    combined = _build_exception_df(store, cat_list, scn_list, breach_list)
    csv_data = combined.to_csv(index=False).encode("utf-8")

    return StreamingResponse(
        BytesIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="aim_exception_report.csv"'},
    )


@app.get("/api/reports/exception/excel")
def reports_exception_excel(
    categories: str = Query(""),
    scenarios: str = Query(""),
    breach_status: str = Query("Yes"),
    user: dict = Depends(get_current_user),
):
    store = _get_store(user)
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    scn_list = [s.strip() for s in scenarios.split(",") if s.strip()] if scenarios else []
    breach_list = [b.strip() for b in breach_status.split(",") if b.strip()]

    combined = _build_exception_df(store, cat_list, scn_list, breach_list)
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        combined.to_excel(writer, index=False, sheet_name="Exceptions")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="aim_exception_report.xlsx"'},
    )


# ══════════════════════════════════════════════════════════════════════════════
#  ASSIGNMENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/assignments")
def assignments_list(
    assigned_to: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    assignments = get_assignments(
        assigned_to=assigned_to,
        status=status if status and status != "All" else None,
        category=category if category and category != "All" else None,
    )
    return {"assignments": assignments}


@app.post("/api/assignments")
def assignments_create(body: AssignmentCreate, user: dict = Depends(get_current_user)):
    assignment_id = create_assignment(
        scenario_name=body.scenario_name,
        category=body.category,
        assigned_to=body.assigned_to,
        assigned_by=user["id"],
        breach_count=body.breach_count,
        record_indices=json.dumps(body.record_indices),
        notes=body.notes,
    )
    return {"id": assignment_id}


@app.put("/api/assignments/{id}/status")
def assignments_update_status(id: int, body: StatusUpdate, user: dict = Depends(get_current_user)):
    update_assignment_status(id, body.status)
    return {"success": True}


@app.put("/api/assignments/{id}/read")
def assignments_mark_read(id: int, user: dict = Depends(get_current_user)):
    mark_assignment_read(id)
    return {"success": True}


@app.delete("/api/assignments/{id}")
def assignments_delete(id: int, user: dict = Depends(get_current_user)):
    delete_assignment(id)
    return {"success": True}


@app.get("/api/assignments/{id}/comments")
def assignments_comments_list(id: int, user: dict = Depends(get_current_user)):
    comments = get_comments(id)
    return {"comments": comments}


@app.post("/api/assignments/{id}/comments")
def assignments_comments_create(id: int, body: CommentCreate, user: dict = Depends(get_current_user)):
    comment_id = add_comment(id, user["id"], body.text)
    return {"id": comment_id}


@app.post("/api/assignments/{id}/documents")
async def assignments_documents_upload(
    id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    file_data = await file.read()
    doc_id = save_document(
        assignment_id=id,
        uploaded_by=user["id"],
        filename=file.filename,
        file_data=file_data,
        file_type=file.content_type or "application/octet-stream",
    )
    return {"id": doc_id}


@app.get("/api/assignments/{id}/documents")
def assignments_documents_list(id: int, user: dict = Depends(get_current_user)):
    documents = get_documents(id)
    return {"documents": documents}


@app.get("/api/documents/{id}/download")
def documents_download(id: int, user: dict = Depends(get_current_user)):
    # Find document by ID
    from auth_db import _get_conn
    conn = _get_conn()
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Document not found")
    doc = dict(row)
    stored_path = doc["stored_path"]
    if not os.path.exists(stored_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(
        stored_path,
        filename=doc["filename"],
        media_type=doc.get("file_type", "application/octet-stream"),
    )


@app.get("/api/assignments/check-duplicates")
def assignments_check_duplicates(
    scenario: str = Query(...),
    indices: str = Query("[]"),
    user: dict = Depends(get_current_user),
):
    try:
        idx_list = json.loads(indices)
    except json.JSONDecodeError:
        idx_list = []
    overlaps = find_duplicate_indices(scenario, idx_list)
    return {"overlaps": overlaps}


# ══════════════════════════════════════════════════════════════════════════════
#  USER ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/users")
def users_list(
    role: Optional[str] = Query(None),
    active_only: bool = Query(True),
    user: dict = Depends(get_current_user),
):
    users = list_users(role=role, active_only=active_only)
    return {"users": users}


@app.put("/api/users/{id}/toggle")
def users_toggle(id: int, user: dict = Depends(get_current_user)):
    from auth_db import _get_conn
    conn = _get_conn()
    row = conn.execute("SELECT is_active FROM users WHERE id = ?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "User not found")
    new_active = not bool(row["is_active"])
    toggle_user_active(id, new_active)
    return {"success": True, "is_active": new_active}


# ══════════════════════════════════════════════════════════════════════════════
#  CUSTOM RULES ENDPOINTS (admin-only, global)
# ══════════════════════════════════════════════════════════════════════════════

def _infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "number"
    return "text"


def _scenario_context(store: dict, scenario_name: str) -> tuple[pd.DataFrame, list[dict], list[dict]]:
    """Return (df, columns_meta, sample_rows) for a scenario."""
    scenario_data = store["scenario_data"]
    if scenario_name not in scenario_data:
        raise HTTPException(404, f"Scenario '{scenario_name}' not found. Upload data first.")
    df = scenario_data[scenario_name]
    skip = {"Breach_Flag", "Breach_Reason"}
    cols = [
        {"name": c, "type": _infer_column_type(df[c])}
        for c in df.columns if c not in skip
    ]
    sample = _clean_df(df.head(3).copy())
    return df, cols, sample


@app.get("/api/custom-rules")
def custom_rules_list(scenario: Optional[str] = None, user: dict = Depends(get_current_user)):
    """List custom rules. All authenticated users can view; only admins can mutate."""
    rules = list_custom_rules(scenario_name=scenario)
    return {"rules": rules}


@app.get("/api/custom-rules/scenarios/{name}/columns")
def custom_rules_columns(name: str, user: dict = Depends(require_admin)):
    """Return column metadata and sample rows for a scenario, used by the UI."""
    store = _get_store(user)
    _df, cols, sample = _scenario_context(store, name)
    return {
        "scenario_name": name,
        "category": SCENARIO_TO_CATEGORY.get(name, "Other"),
        "columns": cols,
        "sample_rows": sample,
        "row_count": len(store["scenario_data"][name]),
    }


@app.post("/api/custom-rules/generate")
def custom_rules_generate(body: CustomRuleGenerate, user: dict = Depends(require_admin)):
    """Ask the LLM to generate a SQL WHERE clause from natural language."""
    store = _get_store(user)
    _df, cols, sample = _scenario_context(store, body.scenario_name)
    try:
        result = generate_rule_from_nl(
            nl_description=body.nl_description,
            scenario_name=body.scenario_name,
            columns=cols,
            sample_rows=sample,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return result


@app.post("/api/custom-rules/preview")
def custom_rules_preview(body: CustomRulePreview, user: dict = Depends(require_admin)):
    """Dry-run a SQL WHERE clause against the uploaded scenario data."""
    store = _get_store(user)
    df, _cols, _sample = _scenario_context(store, body.scenario_name)

    ok, msg = validate_sql_where(body.sql_where)
    if not ok:
        raise HTTPException(400, msg)

    mask, count, err = evaluate_where_on_df(df, body.sql_where)
    if err:
        raise HTTPException(400, err)

    sample_matches = _clean_df(df[mask].head(5).copy()) if count > 0 else []
    return {
        "matched_rows": count,
        "total_rows": len(df),
        "match_rate": round(count / len(df) * 100, 2) if len(df) > 0 else 0,
        "sample_matches": sample_matches,
    }


@app.post("/api/custom-rules")
def custom_rules_create(body: CustomRuleCreate, user: dict = Depends(require_admin)):
    """Create a new custom rule. Validates the SQL expression first."""
    ok, msg = validate_sql_where(body.sql_where)
    if not ok:
        raise HTTPException(400, msg)

    category = SCENARIO_TO_CATEGORY.get(body.scenario_name)
    if not category:
        raise HTTPException(400, f"Unknown scenario '{body.scenario_name}'")

    rule_id = create_custom_rule(
        scenario_name=body.scenario_name,
        category=category,
        rule_name=body.rule_name.strip(),
        nl_description=body.nl_description.strip(),
        sql_where=body.sql_where.strip(),
        breach_reason=body.breach_reason.strip(),
        created_by=user["id"],
        is_active=body.is_active,
    )

    # Re-apply rules so new rule takes effect for this user's current data
    _reapply_if_data_loaded(user)

    return {"id": rule_id, "success": True}


@app.put("/api/custom-rules/{rule_id}")
def custom_rules_update(rule_id: int, body: CustomRuleUpdate, user: dict = Depends(require_admin)):
    existing = get_custom_rule(rule_id)
    if not existing:
        raise HTTPException(404, "Rule not found")

    if body.sql_where is not None:
        ok, msg = validate_sql_where(body.sql_where)
        if not ok:
            raise HTTPException(400, msg)

    changed = update_custom_rule(
        rule_id=rule_id,
        rule_name=body.rule_name,
        nl_description=body.nl_description,
        sql_where=body.sql_where,
        breach_reason=body.breach_reason,
        is_active=body.is_active,
    )
    if not changed:
        raise HTTPException(400, "No fields to update")

    _reapply_if_data_loaded(user)
    return {"success": True}


@app.delete("/api/custom-rules/{rule_id}")
def custom_rules_delete(rule_id: int, user: dict = Depends(require_admin)):
    existing = get_custom_rule(rule_id)
    if not existing:
        raise HTTPException(404, "Rule not found")
    delete_custom_rule(rule_id)
    _reapply_if_data_loaded(user)
    return {"success": True}


def _reapply_if_data_loaded(user: dict) -> None:
    """Recompute breaches for this user's current data if any is loaded.
    No-op if the user has not uploaded anything yet."""
    store = _user_data.get(user["id"])
    if not store:
        return
    try:
        new_master, new_scenario_data = reapply_rules(store["scenario_data"], store["params"])
        store["master_df"] = new_master
        store["scenario_data"] = new_scenario_data
    except Exception as e:
        print(f"[WARN] reapply after custom rule change failed: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  RULES ENDPOINT (no auth)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/rules")
def rules_list():
    rules = []
    for scenario, config in RULES_ENGINE.items():
        thresholds_str = ", ".join(
            f"{k} = {v}" for k, v in config.get("thresholds", {}).items()
        ) if config.get("thresholds") else ""
        rules.append({
            "scenario": scenario,
            "category": config["category"],
            "status": "Active" if config["status"] == "active" else "Hardcoded No",
            "description": config["description"],
            "thresholds": thresholds_str,
            "thresholds_dict": config.get("thresholds", {}),
        })

    # Category summary
    categories = {}
    for cat, scenarios in CATEGORY_MAP.items():
        active = sum(1 for s in scenarios if RULES_ENGINE[s]["status"] == "active")
        hardcoded = len(scenarios) - active
        params_count = sum(len(RULES_ENGINE[s].get("thresholds", {})) for s in scenarios)
        categories[cat] = {
            "total": len(scenarios),
            "active": active,
            "hardcoded": hardcoded,
            "thresholds": params_count,
        }

    total_scenarios = len(RULES_ENGINE)
    active_count = sum(1 for c in RULES_ENGINE.values() if c["status"] == "active")
    hardcoded_count = sum(1 for c in RULES_ENGINE.values() if c["status"] == "hardcoded_no")
    total_thresholds = sum(len(c.get("thresholds", {})) for c in RULES_ENGINE.values())

    custom = list_custom_rules()
    custom_active = sum(1 for r in custom if r.get("is_active"))

    return {
        "rules": rules,
        "categories": categories,
        "custom_rules": custom,
        "stats": {
            "total": total_scenarios,
            "active": active_count,
            "hardcoded": hardcoded_count,
            "total_categories": len(CATEGORY_MAP),
            "total_thresholds": total_thresholds,
            "custom_total": len(custom),
            "custom_active": custom_active,
        },
    }


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    init_db()
    # Ensure SQL GPT directories exist
    os.makedirs(
        os.path.abspath(os.environ.get("SQL_GPT_DB_DIR", "backend/databases")),
        exist_ok=True,
    )
    os.makedirs(
        os.path.abspath(os.environ.get("SQL_GPT_UPLOAD_DIR", "backend/uploads")),
        exist_ok=True,
    )
    # Auto-open browser locally only; skip on hosted/production environments.
    if os.environ.get("RENDER") is None and os.environ.get("PORT") is None:
        import threading, webbrowser
        threading.Timer(1.2, lambda: webbrowser.open("http://localhost:8001")).start()


# ── SQL GPT API routes ──────────────────────────────────────────────────────

app.include_router(_sql_gpt_upload_router, prefix="/sql-gpt-api", tags=["SQL GPT"])
app.include_router(_sql_gpt_query_router, prefix="/sql-gpt-api", tags=["SQL GPT"])
app.include_router(_sql_gpt_download_router, prefix="/sql-gpt-api", tags=["SQL GPT"])


# ── Static files (mount LAST, after all API routes) ─────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    # Render (and most hosts) provide the port via $PORT; fall back to 8001 locally.
    port = int(os.environ.get("PORT", 8001))
    is_hosted = os.environ.get("RENDER") is not None or os.environ.get("PORT") is not None
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=not is_hosted)
