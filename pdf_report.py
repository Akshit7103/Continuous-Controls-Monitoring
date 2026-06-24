"""
AIM Dashboard - PDF Report Generator
Generates a branded, multi-page PDF report with KPIs, charts, tables,
severity analysis, and threshold configuration.
Uses fpdf2 for PDF layout + matplotlib for chart rendering.
"""

from fpdf import FPDF
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from io import BytesIO
from datetime import datetime

# ── Brand colors (RGB tuples) ──────────────────────────────────────────────

PRIMARY    = (16, 56, 90)    # Protiviti Navy #10385A
SECONDARY  = (229, 114, 0)   # Protiviti Orange #E57200
ACCENT     = (89, 152, 197)  # Protiviti Light Blue #5998C5
WHITE      = (255, 255, 255)
LIGHT_BG   = (248, 250, 252)
TEXT_DARK  = (30, 41, 59)    # Slate 800
TEXT_LIGHT = (100, 116, 139) # Slate 500
RED        = (239, 68, 68)   # Tailwind red-500
GREEN      = (16, 185, 129)  # Tailwind emerald-500
AMBER      = (245, 158, 11)  # Tailwind amber-500

# Hex versions for matplotlib
HEX = {
    'primary': '#10385A', 'secondary': '#E57200', 'accent': '#5998C5',
    'red': '#EF4444', 'green': '#10B981', 'amber': '#F59E0B',
    'text': '#1E293B', 'text_light': '#64748B', 'border': '#E2E8F0',
}

CHART_COLORS = [
    '#10385A', '#E57200', '#5998C5', '#EF4444', '#10B981',
    '#14B8A6', '#64748B', '#F59E0B', '#8B5CF6', '#EC4899',
]


# ── Helpers ────────────────────────────────────────────────────────────────

def _severity_color_rgb(rate):
    if rate >= 40: return RED
    if rate >= 20: return AMBER
    return GREEN


def _severity_color_hex(rate):
    if rate >= 40: return HEX['red']
    if rate >= 20: return HEX['amber']
    return HEX['green']


def _chart_to_bytes(fig, dpi=150):
    buf = BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    buf.seek(0)
    return buf


# ── Chart Generators ──────────────────────────────────────────────────────

def _create_category_chart(master_df):
    cat_data = master_df.groupby('Category').agg(
        breaches=('Breaches', 'sum'),
        records=('Total_Records', 'sum'),
    ).reset_index()
    cat_data['rate'] = (cat_data['breaches'] / cat_data['records'] * 100).round(2)
    cat_data = cat_data.sort_values('breaches', ascending=True)

    fig, ax = plt.subplots(figsize=(8.5, 5))
    colors = [_severity_color_hex(r) for r in cat_data['rate']]

    bars = ax.barh(cat_data['Category'], cat_data['breaches'],
                   color=colors, height=0.55, edgecolor='none')

    max_val = cat_data['breaches'].max()
    for bar, val in zip(bars, cat_data['breaches']):
        ax.text(bar.get_width() + max_val * 0.02,
                bar.get_y() + bar.get_height() / 2,
                f'{int(val):,}', va='center', fontsize=9,
                fontweight='600', color=HEX['text'])

    ax.set_xlabel('Number of Breaches', fontsize=10, color=HEX['text'], labelpad=8)
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines[['bottom', 'left']].set_color(HEX['border'])
    ax.tick_params(colors=HEX['text'], labelsize=9)
    ax.set_xlim(0, max_val * 1.2)
    fig.tight_layout()

    return _chart_to_bytes(fig)


def _create_donut_chart(master_df):
    cat_data = master_df.groupby('Category')['Breaches'].sum().sort_values(ascending=False)

    fig, ax = plt.subplots(figsize=(7, 5.5))
    wedges, texts, autotexts = ax.pie(
        cat_data.values, labels=None, autopct='%1.0f%%',
        colors=CHART_COLORS[:len(cat_data)], startangle=90,
        pctdistance=0.78,
        wedgeprops=dict(width=0.42, edgecolor='white', linewidth=2),
    )

    for t in autotexts:
        t.set_fontsize(8)
        t.set_fontweight('600')
        t.set_color('white')

    ax.legend(cat_data.index, loc='center left', bbox_to_anchor=(1.02, 0.5),
              fontsize=8, frameon=False)

    ax.text(0, 0, f'{int(cat_data.sum()):,}\nTotal\nBreaches',
            ha='center', va='center', fontsize=13, fontweight='800',
            color=HEX['primary'], linespacing=1.4)

    fig.tight_layout()
    return _chart_to_bytes(fig)


def _create_top10_chart(master_df):
    top10 = master_df.nlargest(10, 'Breach_Rate').sort_values('Breach_Rate', ascending=True)

    fig, ax = plt.subplots(figsize=(8.5, 4.5))
    colors = [_severity_color_hex(r) for r in top10['Breach_Rate']]

    bars = ax.barh(top10['Scenario'], top10['Breach_Rate'],
                   color=colors, height=0.55, edgecolor='none')

    max_val = top10['Breach_Rate'].max()
    for bar, val in zip(bars, top10['Breach_Rate']):
        ax.text(bar.get_width() + max_val * 0.02,
                bar.get_y() + bar.get_height() / 2,
                f'{val}%', va='center', fontsize=9,
                fontweight='600', color=HEX['text'])

    ax.set_xlabel('Breach Rate (%)', fontsize=10, color=HEX['text'], labelpad=8)
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines[['bottom', 'left']].set_color(HEX['border'])
    ax.tick_params(colors=HEX['text'], labelsize=8)
    ax.set_xlim(0, max_val * 1.15)
    fig.tight_layout()

    return _chart_to_bytes(fig)


def _create_severity_chart(master_df):
    def _band(rate):
        if rate >= 40: return 'Critical (>=40%)'
        if rate >= 20: return 'High (20-40%)'
        if rate >= 5: return 'Medium (5-20%)'
        return 'Low (<5%)'

    bands = master_df['Breach_Rate'].apply(_band)
    band_order = ['Low (<5%)', 'Medium (5-20%)', 'High (20-40%)', 'Critical (>=40%)']
    band_colors = [HEX['green'], '#FBBF24', HEX['amber'], HEX['red']]

    counts = [int((bands == b).sum()) for b in band_order]

    fig, ax = plt.subplots(figsize=(7, 3.5))
    bars = ax.barh(band_order, counts, color=band_colors, height=0.5, edgecolor='none')

    for bar, val in zip(bars, counts):
        if val > 0:
            ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height() / 2,
                    str(val), va='center', fontsize=11, fontweight='700',
                    color=HEX['text'])

    ax.set_xlabel('Number of Scenarios', fontsize=10, color=HEX['text'], labelpad=8)
    ax.spines[['top', 'right']].set_visible(False)
    ax.spines[['bottom', 'left']].set_color(HEX['border'])
    ax.tick_params(colors=HEX['text'], labelsize=10)
    ax.set_xlim(0, max(counts) * 1.2 if max(counts) > 0 else 10)
    fig.tight_layout()

    return _chart_to_bytes(fig)


# ── PDF class with header/footer ──────────────────────────────────────────

class CCMReport(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'A4')
        self.set_auto_page_break(auto=True, margin=25)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*PRIMARY)
        self.rect(0, 0, 210, 14, 'F')
        self.set_fill_color(*ACCENT)
        self.rect(0, 14, 210, 1.2, 'F')
        self.set_font('Helvetica', 'B', 8)
        self.set_text_color(*WHITE)
        self.set_xy(10, 3)
        self.cell(95, 8, 'AIM Breach Analysis Report', 0, 0, 'L')
        self.set_font('Helvetica', '', 7.5)
        self.cell(95, 8, f'{datetime.now().strftime("%d %b %Y %H:%M")}', 0, 0, 'R')
        self.set_text_color(*TEXT_DARK)
        self.set_y(20)

    def footer(self):
        self.set_y(-15)
        self.set_draw_color(*ACCENT)
        self.set_line_width(0.4)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(2)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(*TEXT_LIGHT)
        self.cell(95, 8, 'Confidential - Internal Use Only', 0, 0, 'L')
        self.cell(95, 8, f'Page {self.page_no()}/{{nb}}', 0, 0, 'R')

    def section_title(self, title):
        self.set_font('Helvetica', 'B', 17)
        self.set_text_color(*PRIMARY)
        self.cell(0, 10, title, 0, 1, 'L')
        self.set_draw_color(*ACCENT)
        self.set_line_width(1)
        self.line(self.get_x(), self.get_y() + 1, self.get_x() + 55, self.get_y() + 1)
        self.ln(7)

    def sub_title(self, title):
        self.set_font('Helvetica', 'B', 12)
        self.set_text_color(*SECONDARY)
        self.cell(0, 8, title, 0, 1, 'L')
        self.ln(2)

    def add_table(self, headers, rows, col_widths, highlight_col=None):
        """Render a professional table with alternating rows."""
        row_h = 6.5
        header_h = 7.5
        # Bottom limit: page height (297) - bottom margin (25) - small buffer
        page_limit = 267

        # Header
        self.set_fill_color(*PRIMARY)
        self.set_text_color(*WHITE)
        self.set_font('Helvetica', 'B', 8)
        for w, h in zip(col_widths, headers):
            self.cell(w, header_h, h, 0, 0, 'C', True)
        self.ln()

        # Rows
        self.set_font('Helvetica', '', 8)
        for i, row in enumerate(rows):
            remaining = len(rows) - i
            space_needed = remaining * row_h
            space_available = page_limit - self.get_y()

            # Break ONLY if remaining rows won't fit AND we'd leave
            # more than 2 orphan rows behind (avoid near-empty pages)
            if space_available < row_h + 1 and remaining > 1:
                self.add_page()
                self.set_fill_color(*PRIMARY)
                self.set_text_color(*WHITE)
                self.set_font('Helvetica', 'B', 8)
                for w, h in zip(col_widths, headers):
                    self.cell(w, header_h, h, 0, 0, 'C', True)
                self.ln()
                self.set_font('Helvetica', '', 8)

            fill = i % 2 == 0
            if fill:
                self.set_fill_color(*LIGHT_BG)

            for j, (w, val) in enumerate(zip(col_widths, row)):
                align = 'L' if j == 0 or (j == 1 and len(col_widths) > 4) else 'R'
                if highlight_col is not None and j == highlight_col:
                    try:
                        rate = float(str(val).replace('%', ''))
                        self.set_text_color(*_severity_color_rgb(rate))
                        self.set_font('Helvetica', 'B', 8)
                    except ValueError:
                        self.set_text_color(*TEXT_DARK)
                else:
                    self.set_text_color(*TEXT_DARK)

                self.cell(w, 6.5, str(val), 0, 0, align, fill)
                self.set_font('Helvetica', '', 8)
            self.ln()


# ── Main Report Generator ─────────────────────────────────────────────────

def generate_pdf_report(master_df, params, scenario_data, rules_engine):
    """Generate a branded multi-page PDF report. Returns BytesIO."""

    pdf = CCMReport()
    pdf.alias_nb_pages()

    total_scenarios = len(scenario_data)
    total_records = int(master_df['Total_Records'].sum())
    total_breaches = int(master_df['Breaches'].sum())
    overall_rate = round(total_breaches / total_records * 100, 2) if total_records > 0 else 0

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 1: COVER
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()

    # Top bar
    pdf.set_fill_color(*PRIMARY)
    pdf.rect(0, 0, 210, 58, 'F')
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 58, 210, 2.5, 'F')

    # Bank name
    pdf.set_font('Helvetica', 'B', 32)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(18, 14)
    pdf.cell(0, 14, 'AIM', 0, 1, 'L')

    # Subtitle
    pdf.set_font('Helvetica', '', 15)
    pdf.set_text_color(180, 200, 225)
    pdf.set_x(18)
    pdf.cell(0, 8, 'Analytics in Motion (AIM)', 0, 1, 'L')

    # Report title
    pdf.ln(28)
    pdf.set_font('Helvetica', 'B', 26)
    pdf.set_text_color(*PRIMARY)
    pdf.cell(0, 14, 'AIM Breach Analysis Report', 0, 1, 'C')

    pdf.set_font('Helvetica', '', 12)
    pdf.set_text_color(*TEXT_LIGHT)
    pdf.cell(0, 8, f'Generated on {datetime.now().strftime("%d %B %Y at %H:%M")}', 0, 1, 'C')

    # Summary KPI boxes
    pdf.ln(18)
    box_w = 43
    box_h = 32
    gap = 5
    start_x = (210 - 4 * box_w - 3 * gap) / 2

    summary_items = [
        ('Total Scenarios', str(total_scenarios), PRIMARY),
        ('Total Records', f'{total_records:,}', SECONDARY),
        ('Total Breaches', f'{total_breaches:,}', RED),
        ('Breach Rate', f'{overall_rate}%', _severity_color_rgb(overall_rate)),
    ]

    y = pdf.get_y()
    for i, (label, value, color) in enumerate(summary_items):
        x = start_x + i * (box_w + gap)
        # Card background
        pdf.set_fill_color(*LIGHT_BG)
        pdf.rect(x, y, box_w, box_h, 'DF')
        # Left accent
        pdf.set_fill_color(*color)
        pdf.rect(x, y, 2.5, box_h, 'F')
        # Value
        pdf.set_font('Helvetica', 'B', 18)
        pdf.set_text_color(*PRIMARY)
        pdf.set_xy(x + 6, y + 6)
        pdf.cell(box_w - 10, 10, value, 0, 0, 'L')
        # Label
        pdf.set_font('Helvetica', '', 8)
        pdf.set_text_color(*TEXT_LIGHT)
        pdf.set_xy(x + 6, y + 19)
        pdf.cell(box_w - 10, 6, label.upper(), 0, 0, 'L')

    pdf.set_y(y + box_h + 30)

    # Confidential notice
    pdf.set_font('Helvetica', 'I', 9)
    pdf.set_text_color(*TEXT_LIGHT)
    pdf.cell(0, 8, 'Confidential - For Internal Use Only', 0, 1, 'C')

    # Bottom bar (use text() instead of cell() to avoid triggering auto page break)
    pdf.set_fill_color(*PRIMARY)
    pdf.rect(0, 278, 210, 19, 'F')
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 277, 210, 1.5, 'F')
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(*WHITE)
    pdf.text(42, 288, 'AIM v2.0  |  Risk & Compliance  |  Internal Audit Division')

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 2: EXECUTIVE SUMMARY — CATEGORY BREACHES
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()
    pdf.section_title('Executive Summary')

    pdf.sub_title('Breaches by Category')
    cat_chart = _create_category_chart(master_df)
    pdf.image(cat_chart, x=8, w=194)
    pdf.ln(4)

    # Category table
    cat_data = master_df.groupby('Category').agg(
        Records=('Total_Records', 'sum'),
        Breaches=('Breaches', 'sum'),
    ).reset_index()
    cat_data['Rate'] = (cat_data['Breaches'] / cat_data['Records'] * 100).round(2)
    cat_data = cat_data.sort_values('Breaches', ascending=False)

    rows = []
    for _, r in cat_data.iterrows():
        rows.append([
            str(r['Category']),
            f'{int(r["Records"]):,}',
            f'{int(r["Breaches"]):,}',
            f'{r["Rate"]}%',
        ])

    pdf.add_table(
        headers=['Category', 'Records', 'Breaches', 'Rate (%)'],
        rows=rows,
        col_widths=[80, 35, 35, 30],
        highlight_col=3,
    )

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 3: BREACH DISTRIBUTION
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()
    pdf.section_title('Breach Distribution')

    pdf.sub_title('Breach Share by Category')
    donut_chart = _create_donut_chart(master_df)
    pdf.image(donut_chart, x=20, w=170)

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 4: TOP 10 BREACH SCENARIOS
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()
    pdf.section_title('Top 10 Breach Scenarios')

    top10_chart = _create_top10_chart(master_df)
    pdf.image(top10_chart, x=8, w=194)
    pdf.ln(4)

    top10 = master_df.nlargest(10, 'Breach_Rate')
    rows = []
    for i, (_, r) in enumerate(top10.iterrows()):
        rows.append([
            f'#{i+1}',
            str(r['Scenario'])[:32],
            str(r['Category'])[:26],
            f'{int(r["Total_Records"]):,}',
            f'{int(r["Breaches"]):,}',
            f'{r["Breach_Rate"]}%',
        ])

    pdf.add_table(
        headers=['#', 'Scenario', 'Category', 'Records', 'Breaches', 'Rate'],
        rows=rows,
        col_widths=[10, 55, 48, 25, 25, 22],
        highlight_col=5,
    )

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 5: SEVERITY ANALYSIS
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()
    pdf.section_title('Severity Analysis')

    pdf.sub_title('Scenarios by Severity Band')
    sev_chart = _create_severity_chart(master_df)
    pdf.image(sev_chart, x=15, w=180)
    pdf.ln(4)

    def _band(rate):
        if rate >= 40: return 'Critical (>=40%)'
        if rate >= 20: return 'High (20-40%)'
        if rate >= 5: return 'Medium (5-20%)'
        return 'Low (<5%)'

    master_copy = master_df.copy()
    master_copy['Severity'] = master_copy['Breach_Rate'].apply(_band)

    band_order = ['Critical (>=40%)', 'High (20-40%)', 'Medium (5-20%)', 'Low (<5%)']
    total = len(master_copy)

    rows = []
    for band in band_order:
        count = int((master_copy['Severity'] == band).sum())
        pct = round(count / total * 100, 1) if total > 0 else 0
        rows.append([band, str(count), f'{pct}%'])

    pdf.add_table(
        headers=['Severity Band', 'Scenarios', '% of Total'],
        rows=rows,
        col_widths=[65, 35, 35],
        highlight_col=0,
    )

    # Critical scenarios detail
    critical = master_copy[master_copy['Severity'] == 'Critical (>=40%)']
    if not critical.empty:
        pdf.ln(8)
        pdf.sub_title('Critical Scenarios Requiring Immediate Attention')
        pdf.set_font('Helvetica', '', 9)

        for _, row in critical.sort_values('Breach_Rate', ascending=False).iterrows():
            if pdf.get_y() > 260:
                pdf.add_page()

            pdf.set_text_color(*RED)
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(4, 6, '', 0, 0)
            pdf.cell(0, 7, f'{row["Scenario"]}', 0, 0, 'L')

            pdf.set_text_color(*TEXT_DARK)
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 7, f'  {row["Breach_Rate"]}%  ({int(row["Breaches"])} of {int(row["Total_Records"])})', 0, 1, 'R')

            desc = rules_engine.get(row['Scenario'], {}).get('description', '')
            if desc:
                pdf.set_text_color(*TEXT_LIGHT)
                pdf.set_font('Helvetica', 'I', 8)
                pdf.cell(8, 5, '', 0, 0)
                pdf.cell(0, 5, desc, 0, 1, 'L')
            pdf.ln(2)

    # High-risk scenarios
    high = master_copy[master_copy['Severity'] == 'High (20-40%)']
    if not high.empty:
        pdf.ln(5)
        pdf.sub_title('High-Risk Scenarios')
        pdf.set_font('Helvetica', '', 9)

        for _, row in high.sort_values('Breach_Rate', ascending=False).iterrows():
            if pdf.get_y() > 262:
                pdf.add_page()

            pdf.set_text_color(180, 130, 0)
            pdf.set_font('Helvetica', 'B', 9)
            pdf.cell(4, 6, '', 0, 0)
            pdf.cell(0, 6, f'{row["Scenario"]}', 0, 0, 'L')

            pdf.set_text_color(*TEXT_DARK)
            pdf.set_font('Helvetica', '', 8)
            pdf.cell(0, 6, f'  {row["Breach_Rate"]}%  ({int(row["Breaches"])} breaches)', 0, 1, 'R')
            pdf.ln(1)

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 6: THRESHOLD CONFIGURATION
    # ══════════════════════════════════════════════════════════════════

    pdf.add_page()
    pdf.section_title('Threshold Configuration')

    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(*TEXT_LIGHT)
    pdf.multi_cell(0, 5,
        'Current threshold values used for breach evaluation. '
        'Values highlighted in blue have been modified from engine defaults.'
    )
    pdf.ln(5)

    rows = []
    for scenario, config in rules_engine.items():
        for param_name, default_val in config.get('thresholds', {}).items():
            key = f'{scenario}|{param_name}'
            current_val = params.get(key, default_val)
            modified = '*' if current_val != default_val else ''
            rows.append([
                config['category'][:26],
                scenario[:28],
                param_name[:24],
                f'{current_val}{modified}',
            ])

    pdf.add_table(
        headers=['Category', 'Scenario', 'Parameter', 'Value'],
        rows=rows,
        col_widths=[50, 50, 48, 28],
    )

    # ══════════════════════════════════════════════════════════════════
    #  PAGE 7: ALL SCENARIOS SUMMARY
    # ══════════════════════════════════════════════════════════════════

    # Only add a new page if there isn't enough room for title + a few rows
    if pdf.get_y() > 220:
        pdf.add_page()
    else:
        pdf.ln(10)
    pdf.section_title('Complete Scenario Summary')

    all_scenarios = master_df.sort_values('Breach_Rate', ascending=False)
    rows = []
    for i, (_, r) in enumerate(all_scenarios.iterrows()):
        rows.append([
            str(r['Scenario'])[:30],
            str(r['Category'])[:24],
            f'{int(r["Total_Records"]):,}',
            f'{int(r["Breaches"]):,}',
            f'{r["Breach_Rate"]}%',
        ])

    pdf.add_table(
        headers=['Scenario', 'Category', 'Records', 'Breaches', 'Rate'],
        rows=rows,
        col_widths=[52, 48, 28, 28, 22],
        highlight_col=4,
    )

    # ── Output ────────────────────────────────────────────────────────

    buf = BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return buf
