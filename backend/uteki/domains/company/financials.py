"""
Company financial data fetching via yfinance.
Focus: Business quality data (margins, cash flows, growth) — NOT valuation multiples.
Includes caching via CacheService and expanded data for Buffett/Fisher/Munger frameworks.
"""
from __future__ import annotations
import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional

from uteki.common.cache import get_cache_service

logger = logging.getLogger(__name__)

CACHE_KEY_PREFIX = "uteki:company:data:"
CACHE_TTL = 7 * 24 * 3600  # 7 days


async def fetch_company_data(symbol: str) -> dict:
    """Async wrapper — uses cache, falls back to yfinance in thread pool."""
    symbol = symbol.upper()
    cache = get_cache_service()
    cache_key = f"{CACHE_KEY_PREFIX}{symbol}"

    cached = await cache.get(cache_key)
    if cached is not None:
        logger.info(f"[financials] cache hit for {symbol}")
        cached["_cache_meta"] = {"cached": True, "fetched_at": cached.get("_fetched_at", ""), "cache_ttl_hours": CACHE_TTL // 3600}
        return cached

    logger.info(f"[financials] cache miss for {symbol}, fetching from yfinance")
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, _fetch_sync, symbol)
    except Exception as e:
        logger.error(f"[financials] fetch failed for {symbol}: {e}", exc_info=True)
        return {"symbol": symbol, "error": str(e)}

    data["_fetched_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await cache.set(cache_key, data, ttl=CACHE_TTL)
    except Exception as e:
        logger.warning(f"[financials] cache write failed for {symbol}: {e}")
    data["_cache_meta"] = {"cached": False, "fetched_at": data["_fetched_at"], "cache_ttl_hours": CACHE_TTL // 3600}
    return data


async def invalidate_company_cache(symbol: str) -> None:
    """Delete cached company data for a symbol."""
    cache = get_cache_service()
    cache_key = f"{CACHE_KEY_PREFIX}{symbol.upper()}"
    await cache.delete(cache_key)
    logger.info(f"[financials] cache invalidated for {symbol.upper()}")


def _fetch_sync(symbol: str) -> dict:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    info = ticker.info or {}

    # ── Profile ──────────────────────────────────────────────────────────────
    profile = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "sector": info.get("sector") or "Unknown",
        "industry": info.get("industry") or "Unknown",
        "description": (info.get("longBusinessSummary") or "")[:1000],
        "country": info.get("country") or "",
        "employees": info.get("fullTimeEmployees"),
        "website": info.get("website") or "",
    }

    # ── Price (minimal — just for context) ─────────────────────────────────
    price = (info.get("currentPrice")
             or info.get("regularMarketPrice")
             or info.get("previousClose")
             or 0.0)
    price_data = {
        "current_price": price,
        "market_cap": info.get("marketCap"),
        "shares_outstanding": info.get("sharesOutstanding"),
    }

    # ── Profitability (core business quality) ──────────────────────────────
    profitability = {
        "gross_margin": info.get("grossMargins"),
        "operating_margin": info.get("operatingMargins"),
        "profit_margin": info.get("profitMargins"),
        "roe": info.get("returnOnEquity"),
        "roa": info.get("returnOnAssets"),
    }

    # ── Balance Sheet Health ──────────────────────────────────────────────
    balance = {
        "current_ratio": info.get("currentRatio"),
        "debt_equity": info.get("debtToEquity"),
        "total_cash": info.get("totalCash"),
        "total_debt": info.get("totalDebt"),
    }

    # ── Growth ────────────────────────────────────────────────────────────
    growth = {
        "revenue_growth_yoy": info.get("revenueGrowth"),
        "earnings_growth_yoy": info.get("earningsGrowth"),
        "eps_trailing": info.get("trailingEps"),
        "book_value_per_share": info.get("bookValue"),
    }

    # ── Historical Financials (4 years) ──────────────────────────────────
    income_history = _extract_income(ticker)
    cashflow_history = _extract_cashflow(ticker)

    # ── Derived: Owner Earnings (FCF proxy) ──────────────────────────────
    fcf = info.get("freeCashflow")
    shares = info.get("sharesOutstanding")
    owner_earnings_ps = round(fcf / shares, 2) if fcf and shares and shares > 0 else None

    derived = {
        "owner_earnings_per_share": owner_earnings_ps,
        "free_cashflow": fcf,
    }

    # ── NEW: Management ──────────────────────────────────────────────────
    management = _extract_management(info)

    # ── NEW: Insider Transactions ────────────────────────────────────────
    insider_transactions = _extract_insider_transactions(ticker)

    # ── NEW: Ownership ───────────────────────────────────────────────────
    ownership = _extract_ownership(ticker, info)

    # ── NEW: Balance Sheet History (4-year trends) ───────────────────────
    balance_sheet_history = _extract_balance_sheet_history(ticker)

    # ── NEW: R&D Expenses ────────────────────────────────────────────────
    rd_data = _extract_rd(ticker, income_history)

    # ── NEW: Analyst Estimates ───────────────────────────────────────────
    analyst = _extract_analyst(ticker, info)

    # ── NEW: Governance Risk ─────────────────────────────────────────────
    governance = _extract_governance(info)

    return {
        "profile": profile,
        "price_data": price_data,
        "profitability": profitability,
        "balance": balance,
        "growth": growth,
        "income_history": income_history,
        "cashflow_history": cashflow_history,
        "derived": derived,
        "management": management,
        "insider_transactions": insider_transactions,
        "ownership": ownership,
        "balance_sheet_history": balance_sheet_history,
        "rd_data": rd_data,
        "analyst": analyst,
        "governance": governance,
    }


# ── Extraction Helpers ───────────────────────────────────────────────────────

def _extract_income(ticker) -> list[dict]:
    rows = []
    try:
        fin = ticker.financials
        if fin is None or fin.empty:
            return rows
        for col in fin.columns[:4]:
            def get(key):
                try:
                    return float(fin.loc[key, col]) if key in fin.index else None
                except Exception:
                    return None
            rows.append({
                "year": col.year,
                "revenue": get("Total Revenue"),
                "gross_profit": get("Gross Profit"),
                "operating_income": get("Operating Income"),
                "ebitda": get("EBITDA"),
                "net_income": get("Net Income"),
                "eps": get("Basic EPS"),
            })
    except Exception as e:
        logger.warning(f"[financials] income extract failed: {e}")
    return rows


def _extract_cashflow(ticker) -> list[dict]:
    rows = []
    try:
        cf = ticker.cashflow
        if cf is None or cf.empty:
            return rows
        for col in cf.columns[:4]:
            def get(key):
                try:
                    return float(cf.loc[key, col]) if key in cf.index else None
                except Exception:
                    return None
            ocf = get("Operating Cash Flow")
            capex = get("Capital Expenditure")
            fcf = (ocf + capex) if ocf is not None and capex is not None else None
            rows.append({
                "year": col.year,
                "operating_cf": ocf,
                "capex": capex,
                "fcf": fcf,
                "dividends": get("Cash Dividends Paid"),
            })
    except Exception as e:
        logger.warning(f"[financials] cashflow extract failed: {e}")
    return rows


def _extract_management(info: dict) -> list[dict]:
    """Extract management team from ticker.info['companyOfficers']."""
    try:
        officers = info.get("companyOfficers", [])
        if not officers:
            return []
        result = []
        for o in officers[:10]:  # top 10 officers
            result.append({
                "name": o.get("name", ""),
                "title": o.get("title", ""),
                "age": o.get("age"),
                "total_pay": o.get("totalPay"),
            })
        return result
    except Exception as e:
        logger.warning(f"[financials] management extract failed: {e}")
        return []


def _extract_insider_transactions(ticker) -> list[dict]:
    """Extract recent insider transactions."""
    try:
        df = ticker.insider_transactions
        if df is None or df.empty:
            return []
        rows = []
        for _, row in df.head(15).iterrows():
            rows.append({
                "insider": str(row.get("Insider", row.get("insider", ""))),
                "relation": str(row.get("Relation", row.get("relation", ""))),
                "date": str(row.get("Start Date", row.get("startDate", row.get("date", "")))),
                "transaction": str(row.get("Transaction", row.get("transaction", ""))),
                "shares": _safe_number(row.get("Shares", row.get("shares"))),
                "value": _safe_number(row.get("Value", row.get("value"))),
            })
        return rows
    except Exception as e:
        logger.warning(f"[financials] insider transactions extract failed: {e}")
        return []


def _extract_ownership(ticker, info: dict) -> dict:
    """Extract institutional holders and ownership percentages."""
    result: dict[str, Any] = {
        "insider_pct": info.get("heldPercentInsiders"),
        "institutional_pct": info.get("heldPercentInstitutions"),
        "top_holders": [],
    }
    try:
        holders = ticker.institutional_holders
        if holders is not None and not holders.empty:
            for _, row in holders.head(10).iterrows():
                result["top_holders"].append({
                    "holder": str(row.get("Holder", row.get("holder", ""))),
                    "shares": _safe_number(row.get("Shares", row.get("shares"))),
                    "pct_out": _safe_number(row.get("pctHeld", row.get("% Out", row.get("pct_out")))),
                    "value": _safe_number(row.get("Value", row.get("value"))),
                })
    except Exception as e:
        logger.warning(f"[financials] institutional holders extract failed: {e}")

    try:
        major = ticker.major_holders
        if major is not None and not major.empty:
            # Convert to simple {str: str} to avoid serialization issues
            summary = {}
            for idx, row in major.iterrows():
                vals = [str(v) for v in row.values]
                summary[str(idx)] = " ".join(vals)
            result["major_holders_summary"] = summary
    except Exception as e:
        logger.warning(f"[financials] major holders extract failed: {e}")

    return result


def _extract_balance_sheet_history(ticker) -> list[dict]:
    """Extract 4-year balance sheet for trend analysis."""
    rows = []
    try:
        bs = ticker.balance_sheet
        if bs is None or bs.empty:
            return rows
        for col in bs.columns[:4]:
            def get(key):
                try:
                    return float(bs.loc[key, col]) if key in bs.index else None
                except Exception:
                    return None
            rows.append({
                "year": col.year,
                "accounts_receivable": get("Accounts Receivable") or get("Net Receivables"),
                "inventory": get("Inventory"),
                "total_assets": get("Total Assets"),
                "shareholders_equity": get("Stockholders Equity") or get("Total Stockholder Equity"),
                "shares_outstanding": get("Ordinary Shares Number") or get("Share Issued"),
                "total_current_assets": get("Total Current Assets") or get("Current Assets"),
                "total_current_liabilities": get("Total Current Liabilities") or get("Current Liabilities"),
                "long_term_debt": get("Long Term Debt"),
                "total_liabilities": get("Total Liabilities Net Minority Interest") or get("Total Liab"),
            })
    except Exception as e:
        logger.warning(f"[financials] balance sheet history extract failed: {e}")
    return rows


def _extract_rd(ticker, income_history: list[dict]) -> dict:
    """Extract R&D expenses from financials."""
    result: dict[str, Any] = {"rd_history": [], "rd_pct_revenue": None}
    try:
        fin = ticker.financials
        if fin is None or fin.empty:
            return result
        for col in fin.columns[:4]:
            rd = None
            for key in ["Research Development", "Research And Development"]:
                if key in fin.index:
                    try:
                        rd = float(fin.loc[key, col])
                        break
                    except Exception:
                        pass
            revenue = None
            if "Total Revenue" in fin.index:
                try:
                    revenue = float(fin.loc["Total Revenue", col])
                except Exception:
                    pass
            pct = round(rd / revenue * 100, 2) if rd and revenue and revenue > 0 else None
            result["rd_history"].append({
                "year": col.year,
                "rd_expense": rd,
                "revenue": revenue,
                "rd_pct_revenue": pct,
            })
        # Current R&D % from latest year
        if result["rd_history"] and result["rd_history"][0].get("rd_pct_revenue"):
            result["rd_pct_revenue"] = result["rd_history"][0]["rd_pct_revenue"]
    except Exception as e:
        logger.warning(f"[financials] R&D extract failed: {e}")
    return result


def _extract_analyst(ticker, info: dict) -> dict:
    """Extract analyst estimates and recommendations."""
    result: dict[str, Any] = {
        "target_high": info.get("targetHighPrice"),
        "target_low": info.get("targetLowPrice"),
        "target_mean": info.get("targetMeanPrice"),
        "target_median": info.get("targetMedianPrice"),
        "recommendation_key": info.get("recommendationKey"),
        "number_of_analysts": info.get("numberOfAnalystOpinions"),
        "recommendations": [],
    }
    try:
        recs = ticker.recommendations
        if recs is not None and not recs.empty:
            recent = recs.tail(5)
            for _, row in recent.iterrows():
                rec_entry = {}
                for c in recent.columns:
                    val = row.get(c)
                    if val is None:
                        rec_entry[str(c)] = None
                    elif isinstance(val, (int, float)):
                        rec_entry[str(c)] = _safe_number(val)
                    else:
                        rec_entry[str(c)] = str(val)
                result["recommendations"].append(rec_entry)
    except Exception as e:
        logger.warning(f"[financials] recommendations extract failed: {e}")
    return result


def _extract_governance(info: dict) -> dict:
    """Extract ESG governance risk scores."""
    return {
        "audit_risk": info.get("auditRisk"),
        "board_risk": info.get("boardRisk"),
        "compensation_risk": info.get("compensationRisk"),
        "shareholder_rights_risk": info.get("shareHolderRightsRisk"),
        "overall_risk": info.get("overallRisk"),
    }


def _safe_number(v) -> Optional[float]:
    """Convert a value to float, returning None for non-numeric values."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


# ── Prompt Formatting ────────────────────────────────────────────────────────

def format_company_data_for_prompt(d: dict) -> str:
    """Render company data as structured text for LLM prompt injection.
    Organized by analytical framework with [数据缺失] markers for missing data."""
    profile = d.get("profile", {})
    price = d.get("price_data", {})
    prof = d.get("profitability", {})
    bal = d.get("balance", {})
    growth = d.get("growth", {})
    income = d.get("income_history", [])
    cashflow = d.get("cashflow_history", [])
    derived = d.get("derived", {})
    management = d.get("management", [])
    insider_txns = d.get("insider_transactions", [])
    ownership = d.get("ownership", {})
    bs_history = d.get("balance_sheet_history", [])
    rd_data = d.get("rd_data", {})
    analyst = d.get("analyst", {})
    governance = d.get("governance", {})

    def fmt(v, decimals=2):
        if v is None:
            return "[数据缺失]"
        if isinstance(v, float):
            return f"{v:.{decimals}f}"
        return str(v)

    def fmt_b(v):
        if v is None:
            return "[数据缺失]"
        return f"${v / 1e9:.2f}B"

    def fmt_pct(v):
        if v is None:
            return "[数据缺失]"
        return f"{v * 100:.1f}%"

    def fmt_m(v):
        if v is None:
            return "[数据缺失]"
        return f"${v / 1e6:.1f}M"

    def fmt_risk(v):
        if v is None:
            return "[数据缺失]"
        return f"{v}/10"

    lines = []

    # ── Section 1: 公司概况 (Profile + Management) ────────────────────────
    lines += [
        "=== 第一部分：公司概况 ===",
        f"名称: {profile.get('name')} | 代码: {profile.get('symbol')}",
        f"行业: {profile.get('sector')} / {profile.get('industry')} | 国家: {profile.get('country')}",
        f"员工数: {fmt(profile.get('employees'))}",
        f"当前价格: ${fmt(price.get('current_price'))} | 市值: {fmt_b(price.get('market_cap'))}",
        f"业务简介: {profile.get('description', '') or '[数据缺失]'}",
    ]

    if management:
        lines.append("\n管理团队:")
        for m in management:
            pay = fmt_m(m.get("total_pay")) if m.get("total_pay") else "[数据缺失]"
            age = fmt(m.get("age")) if m.get("age") else "[数据缺失]"
            lines.append(f"  - {m['name']} | {m['title']} | 年龄: {age} | 年薪: {pay}")
    else:
        lines.append("\n管理团队: [数据缺失]")

    # ── Section 2: 巴菲特数据 (Profitability, FCF, Capital, Insider Ownership) ─
    lines += [
        "",
        "=== 第二部分：巴菲特数据（商业品质与资本配置）===",
        "盈利能力:",
        f"  毛利率: {fmt_pct(prof.get('gross_margin'))} | 营业利润率: {fmt_pct(prof.get('operating_margin'))} | 净利率: {fmt_pct(prof.get('profit_margin'))}",
        f"  ROE: {fmt_pct(prof.get('roe'))} | ROA: {fmt_pct(prof.get('roa'))}",
        "",
        "所有者收益:",
        f"  每股自由现金流: ${fmt(derived.get('owner_earnings_per_share'))}",
        f"  总自由现金流: {fmt_b(derived.get('free_cashflow'))}",
        "",
        "资产负债:",
        f"  流动比率: {fmt(bal.get('current_ratio'))} | 负债/权益: {fmt(bal.get('debt_equity'))}",
        f"  现金: {fmt_b(bal.get('total_cash'))} | 总债务: {fmt_b(bal.get('total_debt'))}",
        "",
        "成长:",
        f"  营收增长(YoY): {fmt_pct(growth.get('revenue_growth_yoy'))} | 净利润增长(YoY): {fmt_pct(growth.get('earnings_growth_yoy'))}",
        f"  EPS(TTM): ${fmt(growth.get('eps_trailing'))} | 每股净资产: ${fmt(growth.get('book_value_per_share'))}",
        "",
        "内部人持股:",
        f"  内部人持股比例: {fmt_pct(ownership.get('insider_pct'))}",
        f"  机构持股比例: {fmt_pct(ownership.get('institutional_pct'))}",
    ]

    # ── Section 3: 费雪数据 (R&D, Growth History, Management Compensation) ─
    lines += [
        "",
        "=== 第三部分：费雪数据（成长质量与管理层）===",
    ]

    # R&D
    rd_history = rd_data.get("rd_history", [])
    if rd_history and any(r.get("rd_expense") for r in rd_history):
        lines.append("研发投入:")
        for r in rd_history:
            pct_str = f"{r['rd_pct_revenue']}%" if r.get("rd_pct_revenue") else "[数据缺失]"
            lines.append(f"  {r['year']}: 研发支出={fmt_b(r.get('rd_expense'))} | 占营收比={pct_str}")
    else:
        lines.append("研发投入: [数据缺失]")

    # Employee count + growth context
    lines.append(f"\n员工数: {fmt(profile.get('employees'))}")

    # Revenue growth history from income_history
    if income:
        lines.append("\n营收增长历史:")
        for i, y in enumerate(income):
            rev = y.get("revenue")
            next_rev = income[i + 1].get("revenue") if i + 1 < len(income) else None
            yoy = f"{((rev - next_rev) / next_rev * 100):.1f}%" if rev and next_rev and next_rev > 0 else "[数据缺失]"
            lines.append(f"  {y.get('year')}: 营收={fmt_b(rev)} | YoY={yoy}")

    # Management compensation (from management data)
    if management:
        paid = [m for m in management if m.get("total_pay")]
        if paid:
            lines.append("\n高管薪酬:")
            for m in paid[:5]:
                lines.append(f"  - {m['name']} ({m['title']}): {fmt_m(m['total_pay'])}")
    else:
        lines.append("\n高管薪酬: [数据缺失]")

    # ── Section 4: 芒格数据 (Balance Sheet Trends, Insider Txns, Analyst, Governance) ─
    lines += [
        "",
        "=== 第四部分：芒格数据（风险审计与红旗检测）===",
    ]

    # Balance sheet trends: AR & Inventory vs Revenue
    if bs_history and income:
        lines.append("资产负债趋势（应收/存货 vs 营收）:")
        for bs_row in bs_history:
            year = bs_row["year"]
            # Find matching income year
            inc_row = next((i for i in income if i.get("year") == year), None)
            rev = inc_row.get("revenue") if inc_row else None
            ar = bs_row.get("accounts_receivable")
            inv = bs_row.get("inventory")
            ar_rev_pct = f"{(ar / rev * 100):.1f}%" if ar and rev and rev > 0 else "[数据缺失]"
            inv_rev_pct = f"{(inv / rev * 100):.1f}%" if inv and rev and rev > 0 else "[数据缺失]"
            lines.append(
                f"  {year}: 应收={fmt_b(ar)} (占营收{ar_rev_pct}) | "
                f"存货={fmt_b(inv)} (占营收{inv_rev_pct}) | "
                f"总资产={fmt_b(bs_row.get('total_assets'))} | "
                f"股东权益={fmt_b(bs_row.get('shareholders_equity'))}"
            )
    elif bs_history:
        lines.append("资产负债趋势:")
        for bs_row in bs_history:
            lines.append(
                f"  {bs_row['year']}: 应收={fmt_b(bs_row.get('accounts_receivable'))} | "
                f"存货={fmt_b(bs_row.get('inventory'))} | "
                f"总资产={fmt_b(bs_row.get('total_assets'))} | "
                f"股东权益={fmt_b(bs_row.get('shareholders_equity'))}"
            )
    else:
        lines.append("资产负债趋势: [数据缺失]")

    # Insider transactions
    if insider_txns:
        lines.append("\n近期内部人交易:")
        for t in insider_txns[:10]:
            val_str = fmt_m(t.get("value")) if t.get("value") else "[数据缺失]"
            lines.append(
                f"  - {t.get('date', '?')} | {t.get('insider', '?')} | "
                f"{t.get('transaction', '?')} | 股数: {fmt(t.get('shares'))} | 价值: {val_str}"
            )
    else:
        lines.append("\n近期内部人交易: [数据缺失]")

    # Analyst consensus
    lines.append(f"\n分析师共识:")
    lines.append(f"  目标价: 低={fmt(analyst.get('target_low'))} | 均值={fmt(analyst.get('target_mean'))} | 高={fmt(analyst.get('target_high'))}")
    lines.append(f"  评级: {analyst.get('recommendation_key') or '[数据缺失]'} | 分析师数: {fmt(analyst.get('number_of_analysts'))}")

    # Top institutional holders
    top_holders = ownership.get("top_holders", [])
    if top_holders:
        lines.append(f"\n前十大机构持股:")
        for h in top_holders[:10]:
            pct = f"{h['pct_out'] * 100:.2f}%" if h.get("pct_out") else "[数据缺失]"
            lines.append(f"  - {h.get('holder', '?')} | 持股比例: {pct} | 价值: {fmt_b(h.get('value'))}")
    else:
        lines.append(f"\n机构持股: [数据缺失]")

    # Governance risk scores
    lines.append(f"\n治理风险评分（1-10，越低越好）:")
    lines.append(
        f"  审计风险: {fmt_risk(governance.get('audit_risk'))} | "
        f"董事会风险: {fmt_risk(governance.get('board_risk'))} | "
        f"薪酬风险: {fmt_risk(governance.get('compensation_risk'))} | "
        f"股东权益风险: {fmt_risk(governance.get('shareholder_rights_risk'))} | "
        f"综合风险: {fmt_risk(governance.get('overall_risk'))}"
    )

    # ── Section 5: 历史财务 (Income + Cashflow + Balance Sheet 4-year tables) ─
    lines += ["", "=== 第五部分：历史财务（近4年）==="]

    if income:
        lines.append("\n损益表:")
        for y in income:
            lines.append(
                f"  {y.get('year')}: 营收={fmt_b(y.get('revenue'))} | "
                f"毛利={fmt_b(y.get('gross_profit'))} | "
                f"营业利润={fmt_b(y.get('operating_income'))} | "
                f"净利润={fmt_b(y.get('net_income'))} | EPS=${fmt(y.get('eps'))}"
            )
    else:
        lines.append("\n损益表: [数据缺失]")

    if cashflow:
        lines.append("\n现金流量表:")
        for y in cashflow:
            lines.append(
                f"  {y.get('year')}: 经营CF={fmt_b(y.get('operating_cf'))} | "
                f"CapEx={fmt_b(y.get('capex'))} | FCF={fmt_b(y.get('fcf'))} | "
                f"分红={fmt_b(y.get('dividends'))}"
            )
    else:
        lines.append("\n现金流量表: [数据缺失]")

    if bs_history:
        lines.append("\n资产负债表:")
        for bs_row in bs_history:
            lines.append(
                f"  {bs_row['year']}: 总资产={fmt_b(bs_row.get('total_assets'))} | "
                f"总负债={fmt_b(bs_row.get('total_liabilities'))} | "
                f"股东权益={fmt_b(bs_row.get('shareholders_equity'))} | "
                f"长期债务={fmt_b(bs_row.get('long_term_debt'))} | "
                f"流动资产={fmt_b(bs_row.get('total_current_assets'))} | "
                f"流动负债={fmt_b(bs_row.get('total_current_liabilities'))}"
            )
    else:
        lines.append("\n资产负债表: [数据缺失]")

    return "\n".join(lines)
