"""
AIM Dashboard - Data Loader & Rule Engine
Self-contained rule engine with all 89 scenarios, thresholds, categories, and breach logic.
Excel file is used ONLY for raw data input.
"""

import os
import pandas as pd
import numpy as np

EXCEL_FILE = os.path.join(os.path.dirname(__file__),
    "Federal_Bank_CCM_Scenario_Library_Master_Formula_Extended_v4-1.xlsx")

ACCEPTED_EXTENSIONS = [".xlsx", ".xls"]


# ══════════════════════════════════════════════════════════════════════════
#  RULES ENGINE — Single source of truth for all 89 scenarios
#  Contains: category, description, status, and default thresholds
#  No external file needed for rule definitions.
# ══════════════════════════════════════════════════════════════════════════

RULES_ENGINE = {

    # ── KYC & Customer Onboarding ─────────────────────────────────────

    "KYC_Incomplete": {
        "category": "KYC & Customer Onboarding",
        "description": "KYC pending beyond allowed days post account activation",
        "status": "active",
        "thresholds": {"Max_Days_Without_KYC": 7},
    },
    "PAN_Aadhaar_Mismatch": {
        "category": "KYC & Customer Onboarding",
        "description": "PAN or Aadhaar mismatch between system records and documents",
        "status": "active",
        "thresholds": {},
    },
    "High_Risk_Misclass": {
        "category": "KYC & Customer Onboarding",
        "description": "High transaction volume relative to income but not rated High risk",
        "status": "active",
        "thresholds": {"High_Txn_vs_Income_Multiple": 3},
    },
    "Duplicate_CIF": {
        "category": "KYC & Customer Onboarding",
        "description": "Duplicate PAN or Mobile number across multiple CIFs",
        "status": "active",
        "thresholds": {},
    },
    "Dormant_Reactivation": {
        "category": "KYC & Customer Onboarding",
        "description": "High-value transaction within 7 days of dormant account reactivation",
        "status": "active",
        "thresholds": {"High_Txn_After_Reactivation": 200000},
    },

    # ── AML & Transaction Monitoring ──────────────────────────────────

    "Structuring_Cash": {
        "category": "AML & Transaction Monitoring",
        "description": "Cash transaction near CTR reporting threshold (structuring indicator)",
        "status": "active",
        "thresholds": {"Cash_Deposit_Threshold": 950000},
    },
    "Sanction_Bypass": {
        "category": "AML & Transaction Monitoring",
        "description": "High-risk customer alert closed with insufficient closure notes",
        "status": "active",
        "thresholds": {"Min_Closure_Note_Len": 20},
    },
    "STR_Gap": {
        "category": "AML & Transaction Monitoring",
        "description": "Suspicious transactions meet threshold but STR not filed",
        "status": "active",
        "thresholds": {"Min_Suspicious_Txn_Count": 3},
    },
    "CTR_Gap": {
        "category": "AML & Transaction Monitoring",
        "description": "Cash transaction meets CTR threshold but CTR not filed",
        "status": "active",
        "thresholds": {"CTR_Threshold": 1000000},
    },
    "UPI_Velocity": {
        "category": "AML & Transaction Monitoring",
        "description": "UPI transaction count exceeds threshold within 1 hour",
        "status": "active",
        "thresholds": {"Max_Txn_Count_1hr": 10},
    },
    "SWIFT_CBS_Mismatch": {
        "category": "AML & Transaction Monitoring",
        "description": "SWIFT vs CBS reconciliation (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "AML_Watchlist_NameClose": {
        "category": "AML & Transaction Monitoring",
        "description": "High watchlist match score with insufficient closure notes",
        "status": "active",
        "thresholds": {"Min_Match_Score": 85, "Min_Note_Len": 25},
    },

    # ── Lending & Credit ──────────────────────────────────────────────

    "Loan_Authority_Breach": {
        "category": "Lending & Credit",
        "description": "Loan sanction amount exceeds approver delegation limit",
        "status": "active",
        "thresholds": {},
    },
    "Post_Sanction_Doc": {
        "category": "Lending & Credit",
        "description": "Post-sanction document compliance check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "EMI_Bounce": {
        "category": "Lending & Credit",
        "description": "EMI bounce count meets or exceeds threshold",
        "status": "active",
        "thresholds": {"Bounce_Count_Threshold": 2},
    },
    "Evergreening": {
        "category": "Lending & Credit",
        "description": "Loan evergreening detection (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Collateral_Valuation": {
        "category": "Lending & Credit",
        "description": "Collateral valuation check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Loan_Topup_Delinquent": {
        "category": "Lending & Credit",
        "description": "Loan top-up granted when DPD meets or exceeds threshold",
        "status": "active",
        "thresholds": {"DPD_Threshold": 30},
    },
    "NPA_Class_Delay": {
        "category": "Lending & Credit",
        "description": "DPD exceeds NPA cutoff but account not classified as NPA",
        "status": "active",
        "thresholds": {"DPD_NPA_Cutoff": 90},
    },
    "LOS_Missing_Doc": {
        "category": "Lending & Credit",
        "description": "Loan disbursed with incomplete documents",
        "status": "active",
        "thresholds": {},
    },
    "LOS_Income_Anomaly": {
        "category": "Lending & Credit",
        "description": "Declared income variance vs bureau income exceeds threshold",
        "status": "active",
        "thresholds": {"Max_Variance_Pct": 40},
    },
    "LOS_RiskOverride": {
        "category": "Lending & Credit",
        "description": "Risk model override with insufficient reason documentation",
        "status": "active",
        "thresholds": {"Min_Reason_Len": 30},
    },
    "Credit_Limit_Exceed": {
        "category": "Lending & Credit",
        "description": "Credit utilization exceeds sanctioned limit",
        "status": "active",
        "thresholds": {},
    },
    "NPA_Restruct_Post90": {
        "category": "Lending & Credit",
        "description": "Loan restructured after DPD exceeds cutoff",
        "status": "active",
        "thresholds": {"DPD_Cutoff": 90},
    },

    # ── Treasury & Markets ────────────────────────────────────────────

    "OffMarket_Trade": {
        "category": "Treasury & Markets",
        "description": "Trade price deviation from market price exceeds allowed percentage",
        "status": "active",
        "thresholds": {"Max_Deviation_Pct": 1},
    },
    "Limit_Breach": {
        "category": "Treasury & Markets",
        "description": "Exposure limit breach check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "FX_Override": {
        "category": "Treasury & Markets",
        "description": "FX deal rate spread vs benchmark exceeds allowed percentage",
        "status": "active",
        "thresholds": {"Max_Spread_Pct": 0.5},
    },
    "Treasury_OffMkt_FX": {
        "category": "Treasury & Markets",
        "description": "Treasury FX deal deviation from benchmark exceeds allowed percentage",
        "status": "active",
        "thresholds": {"Max_Deviation_Pct": 0.5},
    },
    "Deriv_Margin_Call_Miss": {
        "category": "Treasury & Markets",
        "description": "Derivative margin call days past due exceeds allowed limit",
        "status": "active",
        "thresholds": {"Max_Days_Past_Due": 2},
    },
    "Securities_Settlement_Fail": {
        "category": "Treasury & Markets",
        "description": "Securities settlement failure beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Fail_Days": 1},
    },

    # ── Operations & IT ───────────────────────────────────────────────

    "Interest_Override": {
        "category": "Operations & IT",
        "description": "Interest rate override exceeding allowed basis points",
        "status": "active",
        "thresholds": {"Max_Override_Bps": 50},
    },
    "Backdated_Opening": {
        "category": "Operations & IT",
        "description": "Account creation date differs from system timestamp beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Backdate_Days": 2},
    },
    "Maker_Checker": {
        "category": "Operations & IT",
        "description": "Maker-checker segregation check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Manual_JE": {
        "category": "Operations & IT",
        "description": "High-value manual journal entry above threshold",
        "status": "active",
        "thresholds": {"High_Manual_JE_Threshold": 1000000},
    },
    "AfterHours_Txn": {
        "category": "Operations & IT",
        "description": "Transaction processed outside business hours",
        "status": "active",
        "thresholds": {"Allowed_Hour_Start": 9},
    },
    "Privileged_Access": {
        "category": "Operations & IT",
        "description": "Privileged access monitoring (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Dormant_User": {
        "category": "Operations & IT",
        "description": "Active employee with no login beyond allowed dormancy period",
        "status": "active",
        "thresholds": {"Max_Days_Since_Login": 45},
    },
    "Data_Extraction": {
        "category": "Operations & IT",
        "description": "Data extraction volume exceeds allowed threshold",
        "status": "active",
        "thresholds": {"Max_Data_Volume_MB": 200},
    },
    "IT_Change_Emergency_Excess": {
        "category": "Operations & IT",
        "description": "Emergency IT change without CAB approval",
        "status": "active",
        "thresholds": {},
    },
    "IT_Priv_User_AfterHours": {
        "category": "Operations & IT",
        "description": "Privileged user performing sensitive action after hours",
        "status": "active",
        "thresholds": {},
    },
    "GL_Recon_Stale_Items": {
        "category": "Operations & IT",
        "description": "GL reconciliation items outstanding beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Outstanding_Days": 15},
    },

    # ── HR & Procurement ──────────────────────────────────────────────

    "Employee_Conflict": {
        "category": "HR & Procurement",
        "description": "Employee-customer conflict check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Incentive_Manip": {
        "category": "HR & Procurement",
        "description": "Account close/open ratio exceeds threshold (churning indicator)",
        "status": "active",
        "thresholds": {"Max_Close_Rate_60d": 0.25},
    },
    "Vendor_Split": {
        "category": "HR & Procurement",
        "description": "Vendor invoice splitting check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Employee_Vendor_Link": {
        "category": "HR & Procurement",
        "description": "Employee-vendor linkage check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "HR_Payroll_Anomaly": {
        "category": "HR & Procurement",
        "description": "Payroll variance exceeds allowed percentage vs 6-month average",
        "status": "active",
        "thresholds": {"Max_Variance_Pct": 25},
    },
    "Procurement_SingleBid": {
        "category": "HR & Procurement",
        "description": "Single-bid procurement award above minimum PO amount",
        "status": "active",
        "thresholds": {"Min_PO_Amount": 500000},
    },
    "Procurement_PO_Split": {
        "category": "HR & Procurement",
        "description": "Multiple POs on same day exceeding threshold (split suspected)",
        "status": "active",
        "thresholds": {"Threshold": 500000},
    },

    # ── Payments & Cards ──────────────────────────────────────────────

    "Ben_Add_Quick_Xfer": {
        "category": "Payments & Cards",
        "description": "High-value transfer within hours of beneficiary addition",
        "status": "active",
        "thresholds": {"Max_Hours_To_First_Txn": 24, "High_Amount_Threshold": 200000},
    },
    "Fee_Reversal_High": {
        "category": "Payments & Cards",
        "description": "High-value fee reversal above threshold",
        "status": "active",
        "thresholds": {"High_Fee_Threshold": 5000},
    },
    "Cash_Wdl_Spike": {
        "category": "Payments & Cards",
        "description": "Cash withdrawal spike vs 30-day average and minimum amount",
        "status": "active",
        "thresholds": {"Spike_Multiple": 5, "Min_Amount": 200000},
    },
    "Card_Issue_Velocity": {
        "category": "Payments & Cards",
        "description": "Multiple cards issued to same CIF within 30 days",
        "status": "active",
        "thresholds": {"Max_Cards_30d": 2},
    },
    "Pwd_Reset_Velocity": {
        "category": "Payments & Cards",
        "description": "Password reset count exceeds threshold within 24 hours",
        "status": "active",
        "thresholds": {"Max_Resets_24h": 2},
    },
    "RTGS_HighValue": {
        "category": "Payments & Cards",
        "description": "RTGS transaction exceeds multiple of average monthly outward",
        "status": "active",
        "thresholds": {"Multiple_vs_Avg": 4, "Min_Amount": 500000},
    },
    "Payments_Repeat_Reversal": {
        "category": "Payments & Cards",
        "description": "Payment reversal count in 30 days exceeds allowed limit",
        "status": "active",
        "thresholds": {"Max_Reversal_Count_30d": 3},
    },
    "NEFT_Return_HighRate": {
        "category": "Payments & Cards",
        "description": "NEFT return rate exceeds allowed maximum",
        "status": "active",
        "thresholds": {"Max_Return_Rate": 0.03},
    },
    "IMPS_Dup_RefID": {
        "category": "Payments & Cards",
        "description": "Duplicate IMPS reference ID detected",
        "status": "active",
        "thresholds": {},
    },
    "UPI_Chargeback_Spike": {
        "category": "Payments & Cards",
        "description": "UPI dispute rate exceeds allowed maximum",
        "status": "active",
        "thresholds": {"Max_Dispute_Rate": 0.01},
    },
    "Cards_Multiple_Declines": {
        "category": "Payments & Cards",
        "description": "Card decline velocity exceeds threshold per hour",
        "status": "active",
        "thresholds": {"Max_Declines_1h": 5},
    },
    "Cards_Chargeback_Spike": {
        "category": "Payments & Cards",
        "description": "Merchant chargeback rate exceeds allowed maximum",
        "status": "active",
        "thresholds": {"Max_Chargeback_Rate": 0.01},
    },
    "Digital_New_Device_HighValue": {
        "category": "Payments & Cards",
        "description": "High-value transaction from new device with suspicious geo distance",
        "status": "active",
        "thresholds": {"High_Amount": 200000, "Max_Geo_Distance_KM": 300},
    },
    "UPI_Beneficiary_Name_Mismatch": {
        "category": "Payments & Cards",
        "description": "UPI beneficiary name mismatch with high-value transaction",
        "status": "active",
        "thresholds": {"Min_Amount": 50000},
    },

    # ── Branch & Customer Service ─────────────────────────────────────

    "Addr_Change_NoOTP": {
        "category": "Branch & Customer Service",
        "description": "High-risk customer address change without OTP verification",
        "status": "active",
        "thresholds": {},
    },
    "Complaint_Aging": {
        "category": "Branch & Customer Service",
        "description": "Customer complaint open beyond SLA days",
        "status": "active",
        "thresholds": {"Max_Open_Days": 7},
    },
    "Branch_Teller_Override_Spike": {
        "category": "Branch & Customer Service",
        "description": "Teller override spike vs 30-day average",
        "status": "active",
        "thresholds": {"Spike_Multiple": 3},
    },
    "Branch_Sales_MisSell": {
        "category": "Branch & Customer Service",
        "description": "Branch complaint-to-sales rate exceeds allowed maximum",
        "status": "active",
        "thresholds": {"Max_Complaint_Rate": 0.02},
    },
    "RM_KYC_Bypass": {
        "category": "Branch & Customer Service",
        "description": "High transactions with incomplete KYC under RM supervision",
        "status": "active",
        "thresholds": {"Min_Txn_7d": 200000},
    },
    "CrossSell_Unauth_Debit": {
        "category": "Branch & Customer Service",
        "description": "Cross-sell product debit without customer consent",
        "status": "active",
        "thresholds": {},
    },
    "CMS_CashPickup_Miss": {
        "category": "Branch & Customer Service",
        "description": "CMS cash pickup variance exceeds allowed tolerance",
        "status": "active",
        "thresholds": {"Max_Variance": 5000},
    },
    "Merchant_Onb_DocGap": {
        "category": "Branch & Customer Service",
        "description": "Merchant onboarding with incomplete docs or MDR override",
        "status": "active",
        "thresholds": {"Max_MDR_Override_Pct": 0.3},
    },

    # ── Collections & Recovery ────────────────────────────────────────

    "Collections_DPD_Promise_Broken": {
        "category": "Collections & Recovery",
        "description": "Promise to pay broken for accounts with DPD above threshold",
        "status": "active",
        "thresholds": {"Min_DPD": 30},
    },
    "Coll_Restructure_Velocity": {
        "category": "Collections & Recovery",
        "description": "Restructure count in 12 months exceeds allowed limit",
        "status": "active",
        "thresholds": {"Max_Restructure_12m": 1},
    },
    "Recovery_Legal_Delay": {
        "category": "Collections & Recovery",
        "description": "Legal recovery stage exceeding target days",
        "status": "active",
        "thresholds": {},
    },
    "Repo_Auction_PriceLow": {
        "category": "Collections & Recovery",
        "description": "Repo auction sale discount exceeds allowed percentage",
        "status": "active",
        "thresholds": {"Max_Discount_Pct": 25},
    },

    # ── Trade Finance ─────────────────────────────────────────────────

    "TradeFinance_LC_Expired_Ship": {
        "category": "Trade Finance",
        "description": "Shipment date after LC expiry date",
        "status": "active",
        "thresholds": {},
    },
    "TradeFinance_Doc_Discrepancy": {
        "category": "Trade Finance",
        "description": "Unresolved LC document discrepancy beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Open_Days": 5},
    },

    # ── Reconciliation & Finance ──────────────────────────────────────

    "Suspense_Aging": {
        "category": "Reconciliation & Finance",
        "description": "Suspense account entries outstanding beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Outstanding_Days": 30},
    },
    "Revenue_Timing": {
        "category": "Reconciliation & Finance",
        "description": "Revenue timing recognition check (hardcoded – no breach)",
        "status": "hardcoded_no",
        "thresholds": {},
    },
    "Nostro_Aging_Breaks": {
        "category": "Reconciliation & Finance",
        "description": "Nostro reconciliation breaks outstanding beyond allowed days",
        "status": "active",
        "thresholds": {"Max_Outstanding_Days": 7},
    },
    "Switch_ATM_Recon_Gap": {
        "category": "Reconciliation & Finance",
        "description": "ATM switch vs CBS reconciliation variance exceeds tolerance",
        "status": "active",
        "thresholds": {"Max_Variance": 5000},
    },
    "Nostro_Recon_Gap": {
        "category": "Reconciliation & Finance",
        "description": "Nostro reconciliation variance exceeds allowed tolerance",
        "status": "active",
        "thresholds": {"Max_Variance": 10000},
    },
    "ATM_Cash_Replenish_Variance": {
        "category": "Reconciliation & Finance",
        "description": "ATM cash replenishment variance exceeds allowed limit",
        "status": "active",
        "thresholds": {"Max_Variance": 5000},
    },
    "Cash_Variance": {
        "category": "Reconciliation & Finance",
        "description": "Cash variance between system and physical count exceeds limit",
        "status": "active",
        "thresholds": {"Max_Variance": 5000},
    },

    # ── Other Lending ─────────────────────────────────────────────────

    "SME_GST_Turnover_Gap": {
        "category": "Other Lending",
        "description": "Gap between GST and declared turnover exceeds allowed percentage",
        "status": "active",
        "thresholds": {"Max_Gap_Pct": 30},
    },
    "Agri_KCC_Overdrawn": {
        "category": "Other Lending",
        "description": "KCC account overdrawn beyond allowed excess percentage",
        "status": "active",
        "thresholds": {"Max_Excess_Pct": 10},
    },
    "LMS_Disb_No_Insurance": {
        "category": "Other Lending",
        "description": "Loan disbursed without required active insurance",
        "status": "active",
        "thresholds": {},
    },
    "Collateral_LTV_Breach": {
        "category": "Other Lending",
        "description": "Loan-to-value ratio exceeds allowed maximum",
        "status": "active",
        "thresholds": {"Max_LTV": 80},
    },
    "Valuation_Stale": {
        "category": "Other Lending",
        "description": "Collateral valuation older than allowed days",
        "status": "active",
        "thresholds": {"Max_Days_Since_Val": 180},
    },
    "Cheque_Return_Spike": {
        "category": "Other Lending",
        "description": "Cheque returns in 90 days exceed allowed count",
        "status": "active",
        "thresholds": {"Max_Returns_90d": 3},
    },
}


# ══════════════════════════════════════════════════════════════════════════
#  Derived constants (auto-built from RULES_ENGINE)
# ══════════════════════════════════════════════════════════════════════════

CATEGORY_MAP = {}
SCENARIO_TO_CATEGORY = {}
RULE_DESCRIPTIONS = {}
HARDCODED_NO = set()

for _scenario, _config in RULES_ENGINE.items():
    _cat = _config["category"]
    SCENARIO_TO_CATEGORY[_scenario] = _cat
    RULE_DESCRIPTIONS[_scenario] = _config["description"]
    if _cat not in CATEGORY_MAP:
        CATEGORY_MAP[_cat] = []
    CATEGORY_MAP[_cat].append(_scenario)
    if _config["status"] == "hardcoded_no":
        HARDCODED_NO.add(_scenario)


# ── Engine params builder ───────────────────────────────────────────────

def get_engine_params() -> dict:
    """Build params dict from RULES_ENGINE thresholds (no Excel dependency)."""
    params = {}
    for scenario, config in RULES_ENGINE.items():
        for param_name, value in config.get("thresholds", {}).items():
            params[f"{scenario}|{param_name}"] = value
    return params


def get_param(params: dict, key: str, default):
    """Get a parameter value, returning default if missing or NaN."""
    val = params.get(key, default)
    if pd.isna(val):
        return default
    return float(val)


# ── Rule registry ───────────────────────────────────────────────────────

RULE_REGISTRY = {}

def rule(name):
    """Decorator to register a breach rule function."""
    def decorator(func):
        RULE_REGISTRY[name] = func
        return func
    return decorator


# ── 78 active breach rule functions ─────────────────────────────────────

@rule("KYC_Incomplete")
def _rule_kyc_incomplete(df, params):
    max_days = get_param(params, "KYC_Incomplete|Max_Days_Without_KYC", 7)
    df["Activation_Date"] = pd.to_datetime(df["Activation_Date"], errors="coerce")
    today = pd.Timestamp.now().normalize()
    mask = (df["KYC_Status"] == "Pending") & ((today - df["Activation_Date"]).dt.days > max_days)
    reason = f"KYC pending > {int(max_days)} days post activation"
    return df, mask, reason


@rule("PAN_Aadhaar_Mismatch")
def _rule_pan_aadhaar(df, params):
    mask = (df["PAN_System"] != df["PAN_Document"]) | (df["Aadhaar_System"] != df["Aadhaar_Document"])
    return df, mask, "PAN or Aadhaar mismatch between system and document"


@rule("High_Risk_Misclass")
def _rule_high_risk_misclass(df, params):
    multiple = get_param(params, "High_Risk_Misclass|High_Txn_vs_Income_Multiple", 3)
    mask = (df["Risk_Rating"] != "High") & (df["Monthly_Txn_Value"] > multiple * (df["Annual_Income"] / 12))
    return df, mask, f"Monthly txn > {int(multiple)}x monthly income but not rated High"


@rule("Duplicate_CIF")
def _rule_duplicate_cif(df, params):
    pan_dup = df["PAN"].map(df["PAN"].value_counts()) > 1
    mobile_dup = df["Mobile_No"].map(df["Mobile_No"].value_counts()) > 1
    mask = pan_dup | mobile_dup
    return df, mask, "Duplicate PAN or Mobile across CIFs"


@rule("Dormant_Reactivation")
def _rule_dormant_reactivation(df, params):
    threshold = get_param(params, "Dormant_Reactivation|High_Txn_After_Reactivation", 200000)
    df["Reactivation_Date"] = pd.to_datetime(df["Reactivation_Date"], errors="coerce")
    df["Txn_Date"] = pd.to_datetime(df["Txn_Date"], errors="coerce")
    mask = ((df["Dormant_Flag"] == "Yes")
            & (df["Txn_Amount"] > threshold)
            & ((df["Txn_Date"] - df["Reactivation_Date"]).dt.days <= 7))
    return df, mask, f"Dormant account: txn > {int(threshold)} within 7 days of reactivation"


@rule("Structuring_Cash")
def _rule_structuring_cash(df, params):
    threshold = get_param(params, "Structuring_Cash|Cash_Deposit_Threshold", 950000)
    mask = df["Txn_Amount"] >= threshold
    return df, mask, f"Cash txn >= {int(threshold)} (near CTR threshold)"


@rule("Interest_Override")
def _rule_interest_override(df, params):
    max_bps = get_param(params, "Interest_Override|Max_Override_Bps", 50)
    mask = (df["Override_Flag"] == "Yes") & ((df["Applied_Rate"] - df["Standard_Rate"]) * 100 > max_bps)
    return df, mask, f"Rate override exceeds {int(max_bps)} bps"


@rule("Backdated_Opening")
def _rule_backdated_opening(df, params):
    max_days = get_param(params, "Backdated_Opening|Max_Backdate_Days", 2)
    df["Creation_Date"] = pd.to_datetime(df["Creation_Date"], errors="coerce")
    df["System_Timestamp"] = pd.to_datetime(df["System_Timestamp"], errors="coerce")
    mask = (df["System_Timestamp"] - df["Creation_Date"]).dt.days.abs() > max_days
    return df, mask, f"Creation date vs system timestamp diff > {int(max_days)} days"


@rule("Loan_Authority_Breach")
def _rule_loan_authority(df, params):
    mask = df["Sanction_Amount"] > df["Delegation_Limit"]
    return df, mask, "Sanction amount exceeds delegation limit"


@rule("EMI_Bounce")
def _rule_emi_bounce(df, params):
    threshold = get_param(params, "EMI_Bounce|Bounce_Count_Threshold", 2)
    mask = df["Bounce_Count"] >= threshold
    return df, mask, f"Bounce count >= {int(threshold)}"


@rule("OffMarket_Trade")
def _rule_offmarket_trade(df, params):
    max_dev = get_param(params, "OffMarket_Trade|Max_Deviation_Pct", 1)
    col = "Deviation_%" if "Deviation_%" in df.columns else "Deviation_Pct"
    mask = df[col].abs() > max_dev
    return df, mask, f"Trade deviation > {max_dev}% from market"


@rule("FX_Override")
def _rule_fx_override(df, params):
    max_spread = get_param(params, "FX_Override|Max_Spread_Pct", 0.5)
    spread = ((df["Deal_Rate"] - df["Benchmark_Rate"]) / df["Benchmark_Rate"]).abs() * 100
    mask = spread > max_spread
    return df, mask, f"FX deal rate spread > {max_spread}% vs benchmark"


@rule("UPI_Velocity")
def _rule_upi_velocity(df, params):
    max_count = get_param(params, "UPI_Velocity|Max_Txn_Count_1hr", 10)
    mask = df["Txn_Count_1hr"] > max_count
    return df, mask, f"UPI txn count > {int(max_count)} in 1 hour"


@rule("Sanction_Bypass")
def _rule_sanction_bypass(df, params):
    min_len = get_param(params, "Sanction_Bypass|Min_Closure_Note_Len", 20)
    mask = (df["Customer_Risk"] == "High") & (df["Closure_Reason"].astype(str).str.len() < min_len)
    return df, mask, f"High-risk customer with closure note < {int(min_len)} chars"


@rule("STR_Gap")
def _rule_str_gap(df, params):
    min_count = get_param(params, "STR_Gap|Min_Suspicious_Txn_Count", 3)
    mask = (df["Suspicious_Txn_Count"] >= min_count) & (df["STR_Filed_Flag"] == "No")
    return df, mask, f"Suspicious txns >= {int(min_count)} but STR not filed"


@rule("CTR_Gap")
def _rule_ctr_gap(df, params):
    threshold = get_param(params, "CTR_Gap|CTR_Threshold", 1000000)
    mask = (df["Cash_Txn_Amount"] >= threshold) & (df["CTR_Filed_Flag"] == "No")
    return df, mask, f"Cash txn >= {int(threshold)} but CTR not filed"


@rule("Cash_Variance")
def _rule_cash_variance(df, params):
    max_var = get_param(params, "Cash_Variance|Max_Variance", 5000)
    mask = df["Variance"].abs() > max_var
    return df, mask, f"Cash variance > {int(max_var)}"


@rule("Manual_JE")
def _rule_manual_je(df, params):
    threshold = get_param(params, "Manual_JE|High_Manual_JE_Threshold", 1000000)
    mask = (df["Manual_Flag"] == "Yes") & (df["Amount"] > threshold)
    return df, mask, f"Manual JE > {int(threshold)}"


@rule("AfterHours_Txn")
def _rule_afterhours(df, params):
    start_hour = int(get_param(params, "AfterHours_Txn|Allowed_Hour_Start", 9))
    hour = df["Txn_Time"].astype(str).str.split(":").str[0].astype(int)
    mask = (hour < start_hour) | (hour >= 20)
    return df, mask, f"Transaction outside business hours ({start_hour}:00-20:00)"


@rule("Dormant_User")
def _rule_dormant_user(df, params):
    max_days = get_param(params, "Dormant_User|Max_Days_Since_Login", 45)
    df["Last_Login_Date"] = pd.to_datetime(df["Last_Login_Date"], errors="coerce")
    today = pd.Timestamp.now().normalize()
    mask = (df["HR_Status"] == "Active") & ((today - df["Last_Login_Date"]).dt.days > max_days)
    return df, mask, f"Active user: last login > {int(max_days)} days ago"


@rule("Data_Extraction")
def _rule_data_extraction(df, params):
    max_vol = get_param(params, "Data_Extraction|Max_Data_Volume_MB", 200)
    mask = df["Data_Volume_MB"] > max_vol
    return df, mask, f"Data extraction > {int(max_vol)} MB"


@rule("Incentive_Manip")
def _rule_incentive_manip(df, params):
    max_rate = get_param(params, "Incentive_Manip|Max_Close_Rate_60d", 0.25)
    ratio = df["Accounts_Closed_60d"] / df["Accounts_Opened"].replace(0, np.nan)
    mask = ratio > max_rate
    return df, mask, f"Close/Open ratio > {max_rate}"


@rule("Suspense_Aging")
def _rule_suspense_aging(df, params):
    max_days = get_param(params, "Suspense_Aging|Max_Outstanding_Days", 30)
    mask = df["Outstanding_Days"] > max_days
    return df, mask, f"Suspense outstanding > {int(max_days)} days"


@rule("Complaint_Aging")
def _rule_complaint_aging(df, params):
    max_days = get_param(params, "Complaint_Aging|Max_Open_Days", 7)
    mask = df["Open_Days"] > max_days
    return df, mask, f"Complaint open > {int(max_days)} days"


@rule("Addr_Change_NoOTP")
def _rule_addr_change(df, params):
    mask = (df["Risk_Rating"] == "High") & (df["OTP_Verified"] == "No")
    return df, mask, "High-risk address change without OTP"


@rule("Ben_Add_Quick_Xfer")
def _rule_ben_add_quick(df, params):
    max_hours = get_param(params, "Ben_Add_Quick_Xfer|Max_Hours_To_First_Txn", 24)
    high_amount = get_param(params, "Ben_Add_Quick_Xfer|High_Amount_Threshold", 200000)
    df["Ben_Add_Date"] = pd.to_datetime(df["Ben_Add_Date"], errors="coerce")
    df["First_Txn_Date"] = pd.to_datetime(df["First_Txn_Date"], errors="coerce")
    hours_diff = (df["First_Txn_Date"] - df["Ben_Add_Date"]).dt.total_seconds() / 3600
    mask = (hours_diff <= max_hours) & (df["Txn_Amount"] >= high_amount)
    return df, mask, f"High-value txn ({int(high_amount)}) within {int(max_hours)}h of beneficiary add"


@rule("Fee_Reversal_High")
def _rule_fee_reversal(df, params):
    threshold = get_param(params, "Fee_Reversal_High|High_Fee_Threshold", 5000)
    mask = (df["Reversed_Flag"] == "Yes") & (df["Fee_Amount"] >= threshold)
    return df, mask, f"Fee reversal >= {int(threshold)}"


@rule("Cash_Wdl_Spike")
def _rule_cash_wdl_spike(df, params):
    multiple = get_param(params, "Cash_Wdl_Spike|Spike_Multiple", 5)
    min_amount = get_param(params, "Cash_Wdl_Spike|Min_Amount", 200000)
    mask = (df["Txn_Amount"] >= multiple * df["Prev30d_Avg_Wdl"]) & (df["Txn_Amount"] >= min_amount)
    return df, mask, f"Withdrawal >= {int(multiple)}x avg AND >= {int(min_amount)}"


@rule("Card_Issue_Velocity")
def _rule_card_issue(df, params):
    max_cards = get_param(params, "Card_Issue_Velocity|Max_Cards_30d", 2)
    mask = df["Cards_Issued_30d"] > max_cards
    return df, mask, f"Cards issued in 30d > {int(max_cards)}"


@rule("Pwd_Reset_Velocity")
def _rule_pwd_reset(df, params):
    max_resets = get_param(params, "Pwd_Reset_Velocity|Max_Resets_24h", 2)
    mask = df["Resets_24h"] > max_resets
    return df, mask, f"Password resets in 24h > {int(max_resets)}"


@rule("RTGS_HighValue")
def _rule_rtgs_highval(df, params):
    multiple = get_param(params, "RTGS_HighValue|Multiple_vs_Avg", 4)
    min_amount = get_param(params, "RTGS_HighValue|Min_Amount", 500000)
    mask = (df["Txn_Amount"] >= multiple * df["Avg_Monthly_Out"]) & (df["Txn_Amount"] >= min_amount)
    return df, mask, f"RTGS txn >= {int(multiple)}x avg AND >= {int(min_amount)}"


@rule("Cheque_Return_Spike")
def _rule_cheque_return(df, params):
    max_returns = get_param(params, "Cheque_Return_Spike|Max_Returns_90d", 3)
    mask = df["Returns_90d"] > max_returns
    return df, mask, f"Cheque returns in 90d > {int(max_returns)}"


@rule("Merchant_Onb_DocGap")
def _rule_merchant_onb(df, params):
    max_mdr = get_param(params, "Merchant_Onb_DocGap|Max_MDR_Override_Pct", 0.3)
    mask = ((df["Doc_Complete"] != "Complete")
            | ((df["Override_Flag"] == "Yes") & ((df["MDR_Applied"] - df["MDR_Std"]).abs() > max_mdr)))
    return df, mask, f"Incomplete docs or MDR override > {max_mdr} pct pts"


@rule("Nostro_Aging_Breaks")
def _rule_nostro_aging(df, params):
    max_days = get_param(params, "Nostro_Aging_Breaks|Max_Outstanding_Days", 7)
    mask = df["Outstanding_Days"] > max_days
    return df, mask, f"Nostro break outstanding > {int(max_days)} days"


@rule("Loan_Topup_Delinquent")
def _rule_loan_topup(df, params):
    dpd_threshold = get_param(params, "Loan_Topup_Delinquent|DPD_Threshold", 30)
    mask = df["DPD_Before"] >= dpd_threshold
    return df, mask, f"Top-up granted when DPD >= {int(dpd_threshold)}"


@rule("NPA_Class_Delay")
def _rule_npa_class(df, params):
    dpd_cutoff = get_param(params, "NPA_Class_Delay|DPD_NPA_Cutoff", 90)
    mask = (df["DPD"] >= dpd_cutoff) & (df["Actual_NPA_Flag"] != "Yes")
    return df, mask, f"DPD >= {int(dpd_cutoff)} but NPA not classified"


@rule("Treasury_OffMkt_FX")
def _rule_treasury_fx(df, params):
    max_dev = get_param(params, "Treasury_OffMkt_FX|Max_Deviation_Pct", 0.5)
    mask = df["Deviation_Pct"] > max_dev
    return df, mask, f"FX deviation > {max_dev}%"


@rule("Deriv_Margin_Call_Miss")
def _rule_deriv_margin(df, params):
    max_dpd = get_param(params, "Deriv_Margin_Call_Miss|Max_Days_Past_Due", 2)
    mask = df["Days_Past_Due"] > max_dpd
    return df, mask, f"Margin call days past due > {int(max_dpd)}"


@rule("Securities_Settlement_Fail")
def _rule_securities_fail(df, params):
    max_fail = get_param(params, "Securities_Settlement_Fail|Max_Fail_Days", 1)
    mask = df["Fail_Days"] > max_fail
    return df, mask, f"Settlement fail > {int(max_fail)} days"


@rule("TradeFinance_LC_Expired_Ship")
def _rule_lc_expired(df, params):
    df["Shipment_Date"] = pd.to_datetime(df["Shipment_Date"], errors="coerce")
    df["Expiry_Date"] = pd.to_datetime(df["Expiry_Date"], errors="coerce")
    mask = df["Shipment_Date"] > df["Expiry_Date"]
    return df, mask, "Shipment date after LC expiry"


@rule("TradeFinance_Doc_Discrepancy")
def _rule_doc_discrep(df, params):
    max_days = get_param(params, "TradeFinance_Doc_Discrepancy|Max_Open_Days", 5)
    mask = (df["Discrepancy_Resolved"] == "No") & (df["Days_Open"] > max_days)
    return df, mask, f"Unresolved discrepancy open > {int(max_days)} days"


@rule("Collections_DPD_Promise_Broken")
def _rule_collections_dpd(df, params):
    min_dpd = get_param(params, "Collections_DPD_Promise_Broken|Min_DPD", 30)
    mask = (df["DPD"] >= min_dpd) & (df["Promise_Kept"] == "No")
    return df, mask, f"DPD >= {int(min_dpd)} and promise to pay broken"


@rule("Coll_Restructure_Velocity")
def _rule_restructure_vel(df, params):
    max_count = get_param(params, "Coll_Restructure_Velocity|Max_Restructure_12m", 1)
    mask = df["Restructure_Count_12m"] > max_count
    return df, mask, f"Restructure count in 12m > {int(max_count)}"


@rule("Cards_Multiple_Declines")
def _rule_cards_declines(df, params):
    max_declines = get_param(params, "Cards_Multiple_Declines|Max_Declines_1h", 5)
    mask = df["Declines_1h"] > max_declines
    return df, mask, f"Declines in 1h > {int(max_declines)}"


@rule("Cards_Chargeback_Spike")
def _rule_cards_chargeback(df, params):
    max_rate = get_param(params, "Cards_Chargeback_Spike|Max_Chargeback_Rate", 0.01)
    mask = df["Chargeback_Rate"] > max_rate
    return df, mask, f"Chargeback rate > {max_rate}"


@rule("Digital_New_Device_HighValue")
def _rule_digital_newdev(df, params):
    high_amount = get_param(params, "Digital_New_Device_HighValue|High_Amount", 200000)
    max_geo = get_param(params, "Digital_New_Device_HighValue|Max_Geo_Distance_KM", 300)
    mask = ((df["New_Device_Flag"] == "Yes")
            & (df["Txn_Amount"] >= high_amount)
            & (df["Geo_Distance_KM"] > max_geo))
    return df, mask, f"New device + txn >= {int(high_amount)} + geo > {int(max_geo)} km"


@rule("UPI_Beneficiary_Name_Mismatch")
def _rule_upi_name_mismatch(df, params):
    min_amount = get_param(params, "UPI_Beneficiary_Name_Mismatch|Min_Amount", 50000)
    mask = (df["Beneficiary_Name"] != df["Account_Name"]) & (df["Txn_Amount"] >= min_amount)
    return df, mask, f"Beneficiary name mismatch with txn >= {int(min_amount)}"


@rule("ATM_Cash_Replenish_Variance")
def _rule_atm_cash(df, params):
    max_var = get_param(params, "ATM_Cash_Replenish_Variance|Max_Variance", 5000)
    mask = df["Variance"].abs() > max_var
    return df, mask, f"ATM replenish variance > {int(max_var)}"


@rule("Branch_Teller_Override_Spike")
def _rule_teller_override(df, params):
    spike_mult = get_param(params, "Branch_Teller_Override_Spike|Spike_Multiple", 3)
    mask = df["Overrides_Day"] > spike_mult * df["Avg_Overrides_30d"]
    return df, mask, f"Teller overrides > {int(spike_mult)}x 30d avg"


@rule("HR_Payroll_Anomaly")
def _rule_payroll_anomaly(df, params):
    max_var = get_param(params, "HR_Payroll_Anomaly|Max_Variance_Pct", 25)
    mask = df["Variance_Pct"].abs() > max_var
    return df, mask, f"Payroll variance > {int(max_var)}%"


@rule("Procurement_SingleBid")
def _rule_single_bid(df, params):
    min_amount = get_param(params, "Procurement_SingleBid|Min_PO_Amount", 500000)
    mask = (df["Bids_Received"] == 1) & (df["PO_Amount"] >= min_amount)
    return df, mask, f"Single bid with PO >= {int(min_amount)}"


@rule("Procurement_PO_Split")
def _rule_po_split(df, params):
    threshold = get_param(params, "Procurement_PO_Split|Threshold", 500000)
    mask = (df["PO_Count_Day"] >= 4) & (df["Total_PO_Value_Day"] > threshold)
    return df, mask, f"PO count >= 4 with total > {int(threshold)} (split suspected)"


@rule("IT_Change_Emergency_Excess")
def _rule_it_emergency(df, params):
    mask = (df["Emergency_Flag"] == "Yes") & (df["CAB_Approved"] != "Yes")
    return df, mask, "Emergency change without CAB approval"


@rule("IT_Priv_User_AfterHours")
def _rule_it_priv_afterhours(df, params):
    sensitive_roles = {"Admin", "DBA", "SecOps"}
    sensitive_actions = {"Export", "RoleChange", "Delete"}
    mask = ((df["AfterHours_Flag"] == "Yes")
            & (df["Role"].isin(sensitive_roles))
            & (df["Action"].isin(sensitive_actions)))
    return df, mask, "Privileged user performing sensitive action after hours"


@rule("GL_Recon_Stale_Items")
def _rule_gl_recon(df, params):
    max_days = get_param(params, "GL_Recon_Stale_Items|Max_Outstanding_Days", 15)
    mask = df["Outstanding_Days"] > max_days
    return df, mask, f"GL recon item outstanding > {int(max_days)} days"


@rule("AML_Watchlist_NameClose")
def _rule_aml_watchlist(df, params):
    min_score = get_param(params, "AML_Watchlist_NameClose|Min_Match_Score", 85)
    min_note = get_param(params, "AML_Watchlist_NameClose|Min_Note_Len", 25)
    mask = ((df["Match_Score"] >= min_score)
            & (df["Closure_Note"].astype(str).str.len() < min_note))
    return df, mask, f"Match score >= {int(min_score)} with closure note < {int(min_note)} chars"


@rule("LOS_Missing_Doc")
def _rule_los_missing(df, params):
    mask = (df["Doc_Complete"] != "Complete") & (df["Disbursed_Flag"] == "Yes")
    return df, mask, "Disbursed with incomplete documents"


@rule("LOS_Income_Anomaly")
def _rule_los_income(df, params):
    max_var = get_param(params, "LOS_Income_Anomaly|Max_Variance_Pct", 40)
    mask = df["Variance_Pct"].abs() > max_var
    return df, mask, f"Income variance > {int(max_var)}% vs bureau"


@rule("LOS_RiskOverride")
def _rule_los_risk_override(df, params):
    min_len = get_param(params, "LOS_RiskOverride|Min_Reason_Len", 30)
    mask = (df["Override_Flag"] == "Yes") & (df["Override_Reason_Len"] < min_len)
    return df, mask, f"Risk override with reason < {int(min_len)} chars"


@rule("Credit_Limit_Exceed")
def _rule_credit_limit(df, params):
    mask = df["Excess"] > 0
    return df, mask, "Utilization exceeds credit limit"


@rule("SME_GST_Turnover_Gap")
def _rule_sme_gst(df, params):
    max_gap = get_param(params, "SME_GST_Turnover_Gap|Max_Gap_Pct", 30)
    mask = df["Gap_Pct"].abs() > max_gap
    return df, mask, f"GST vs declared turnover gap > {int(max_gap)}%"


@rule("Agri_KCC_Overdrawn")
def _rule_agri_kcc(df, params):
    max_excess = get_param(params, "Agri_KCC_Overdrawn|Max_Excess_Pct", 10)
    limit = df["Limit"].replace(0, np.nan)
    mask = ((df["Utilized"] - df["Limit"]) / limit * 100) > max_excess
    return df, mask, f"KCC overdrawn by > {int(max_excess)}%"


@rule("LMS_Disb_No_Insurance")
def _rule_lms_insurance(df, params):
    mask = (df["Insurance_Required"] == "Yes") & (df["Insurance_Active"] != "Yes")
    return df, mask, "Insurance required but not active at disbursal"


@rule("Collateral_LTV_Breach")
def _rule_collateral_ltv(df, params):
    max_ltv = get_param(params, "Collateral_LTV_Breach|Max_LTV", 80)
    mask = df["LTV_Pct"] > max_ltv
    return df, mask, f"LTV > {int(max_ltv)}%"


@rule("Valuation_Stale")
def _rule_valuation_stale(df, params):
    max_days = get_param(params, "Valuation_Stale|Max_Days_Since_Val", 180)
    mask = df["Days_Since_Val"] > max_days
    return df, mask, f"Valuation older than {int(max_days)} days"


@rule("NPA_Restruct_Post90")
def _rule_npa_restruct(df, params):
    dpd_cutoff = get_param(params, "NPA_Restruct_Post90|DPD_Cutoff", 90)
    mask = (df["DPD"] >= dpd_cutoff) & (df["Restruct_Flag"] == "Yes")
    return df, mask, f"Restructured post DPD {int(dpd_cutoff)}"


@rule("Recovery_Legal_Delay")
def _rule_recovery_legal(df, params):
    mask = df["Days_In_Stage"] > df["Target_Days"]
    return df, mask, "Legal recovery exceeding target days"


@rule("Repo_Auction_PriceLow")
def _rule_repo_auction(df, params):
    max_disc = get_param(params, "Repo_Auction_PriceLow|Max_Discount_Pct", 25)
    mask = df["Discount_Pct"] > max_disc
    return df, mask, f"Auction discount > {int(max_disc)}%"


@rule("Payments_Repeat_Reversal")
def _rule_repeat_reversal(df, params):
    max_count = get_param(params, "Payments_Repeat_Reversal|Max_Reversal_Count_30d", 3)
    mask = df["Reversal_Count_30d"] > max_count
    return df, mask, f"Reversals in 30d > {int(max_count)}"


@rule("NEFT_Return_HighRate")
def _rule_neft_return(df, params):
    max_rate = get_param(params, "NEFT_Return_HighRate|Max_Return_Rate", 0.03)
    mask = df["NEFT_Return_Rate"] > max_rate
    return df, mask, f"NEFT return rate > {max_rate}"


@rule("IMPS_Dup_RefID")
def _rule_imps_dup(df, params):
    mask = df["Duplicate_Count"] > 1
    return df, mask, "Duplicate IMPS reference ID"


@rule("UPI_Chargeback_Spike")
def _rule_upi_chargeback(df, params):
    max_rate = get_param(params, "UPI_Chargeback_Spike|Max_Dispute_Rate", 0.01)
    mask = df["Dispute_Rate"] > max_rate
    return df, mask, f"UPI dispute rate > {max_rate}"


@rule("CMS_CashPickup_Miss")
def _rule_cms_cash(df, params):
    max_var = get_param(params, "CMS_CashPickup_Miss|Max_Variance", 5000)
    mask = df["Variance"].abs() > max_var
    return df, mask, f"CMS cash pickup variance > {int(max_var)}"


@rule("Switch_ATM_Recon_Gap")
def _rule_switch_atm(df, params):
    max_var = get_param(params, "Switch_ATM_Recon_Gap|Max_Variance", 5000)
    mask = df["Variance"].abs() > max_var
    return df, mask, f"ATM switch-CBS variance > {int(max_var)}"


@rule("Nostro_Recon_Gap")
def _rule_nostro_recon(df, params):
    max_var = get_param(params, "Nostro_Recon_Gap|Max_Variance", 10000)
    mask = df["Variance"].abs() > max_var
    return df, mask, f"Nostro recon variance > {int(max_var)}"


@rule("Branch_Sales_MisSell")
def _rule_branch_missell(df, params):
    max_rate = get_param(params, "Branch_Sales_MisSell|Max_Complaint_Rate", 0.02)
    mask = df["Complaint_Rate"] > max_rate
    return df, mask, f"Complaint/sales rate > {max_rate}"


@rule("RM_KYC_Bypass")
def _rule_rm_kyc(df, params):
    min_txn = get_param(params, "RM_KYC_Bypass|Min_Txn_7d", 200000)
    mask = (df["KYC_Status"] != "Complete") & (df["Txn_7d"] >= min_txn)
    return df, mask, f"Incomplete KYC with txn_7d >= {int(min_txn)}"


@rule("CrossSell_Unauth_Debit")
def _rule_crosssell(df, params):
    mask = df["Consent_Flag"] != "Yes"
    return df, mask, "Cross-sell debit without consent"


# ── Dispatcher ──────────────────────────────────────────────────────────────

def apply_breach_rules(sheet_name: str, df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Apply breach rules to a scenario DataFrame. Returns df with Breach_Flag and Breach_Reason."""
    # Initialize defaults
    df["Breach_Flag"] = "No"
    df["Breach_Reason"] = ""

    if sheet_name not in HARDCODED_NO:
        rule_func = RULE_REGISTRY.get(sheet_name)
        if rule_func is not None:
            try:
                df, mask, reason = rule_func(df, params)
                mask = mask.fillna(False)
                df.loc[mask, "Breach_Flag"] = "Yes"
                df.loc[mask, "Breach_Reason"] = reason
            except Exception as e:
                print(f"[WARN] Rule {sheet_name} failed: {e}")

    # Apply user-defined custom rules (runs for every scenario, including
    # HARDCODED_NO ones and those without a built-in rule function)
    try:
        from custom_rules import apply_custom_rules_to_scenario
        df = apply_custom_rules_to_scenario(sheet_name, df)
    except Exception as e:
        print(f"[WARN] Custom rules for {sheet_name} failed: {e}")

    return df


# ── Main entry point ───────────────────────────────────────────────────────

def load_all_data(source=None):
    """
    Load all Excel data, apply breach rules, return:
        (params_dict, master_df, scenario_data_dict)
    where scenario_data_dict maps sheet_name -> DataFrame with Breach_Flag applied.
    source can be a filepath string or a file-like object (BytesIO from st.file_uploader).
    Thresholds come from the built-in RULES_ENGINE, not from the Excel file.
    """
    if source is None:
        source = EXCEL_FILE
    xls = pd.ExcelFile(source)
    params = get_engine_params()

    scenario_sheets = [s for s in xls.sheet_names if s not in ("Master", "Params")]
    scenario_data = {}
    summary_rows = []

    for sheet in scenario_sheets:
        try:
            df = pd.read_excel(xls, sheet_name=sheet)
            # Drop any existing Breach_Flag / Breach_Reason columns (they're NaN from formulas)
            for col in ["Breach_Flag", "Breach_Reason"]:
                if col in df.columns:
                    df = df.drop(columns=[col])
            df = apply_breach_rules(sheet, df, params)
            scenario_data[sheet] = df

            total = len(df)
            breaches = int((df["Breach_Flag"] == "Yes").sum())
            rate = round(breaches / total * 100, 2) if total > 0 else 0.0
            category = SCENARIO_TO_CATEGORY.get(sheet, "Other")
            summary_rows.append({
                "Scenario": sheet,
                "Category": category,
                "Total_Records": total,
                "Breaches": breaches,
                "Breach_Rate": rate,
            })
        except Exception as e:
            print(f"[WARN] Failed to load sheet '{sheet}': {e}")

    master_df = pd.DataFrame(summary_rows)
    return params, master_df, scenario_data


def reapply_rules(scenario_data: dict, new_params: dict):
    """Re-apply breach rules to all scenarios with updated params.
    Returns (new_master_df, new_scenario_data)."""
    new_scenario_data = {}
    summary_rows = []
    for sheet, df in scenario_data.items():
        df = df.copy()
        for col in ["Breach_Flag", "Breach_Reason"]:
            if col in df.columns:
                df = df.drop(columns=[col])
        df = apply_breach_rules(sheet, df, new_params)
        new_scenario_data[sheet] = df
        total = len(df)
        breaches = int((df["Breach_Flag"] == "Yes").sum())
        rate = round(breaches / total * 100, 2) if total > 0 else 0.0
        category = SCENARIO_TO_CATEGORY.get(sheet, "Other")
        summary_rows.append({
            "Scenario": sheet,
            "Category": category,
            "Total_Records": total,
            "Breaches": breaches,
            "Breach_Rate": rate,
        })
    master_df = pd.DataFrame(summary_rows)
    return master_df, new_scenario_data


# Allow standalone testing
if __name__ == "__main__":
    params, master, data = load_all_data()
    print(f"Loaded {len(data)} scenarios")
    print(f"Total records: {master['Total_Records'].sum()}")
    print(f"Total breaches: {master['Breaches'].sum()}")
    print(f"Overall breach rate: {master['Breaches'].sum() / master['Total_Records'].sum() * 100:.2f}%")
    print("\nTop 10 by breach rate:")
    print(master.nlargest(10, "Breach_Rate")[["Scenario", "Breaches", "Breach_Rate"]].to_string(index=False))
