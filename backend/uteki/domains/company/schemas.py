"""
Company Agent — Pydantic schemas for skill outputs and API I/O.

Pipeline: Buffett (Moat) → Fisher (15 Points) → Munger (Risk) → Verdict
Focus: Is this a great business worth holding forever? Then: is the price right?
"""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Literal, Optional


# ── Skill 1: Business Quality & Moat (Buffett) ───────────────────────────

class MoatAssessmentOutput(BaseModel):
    business_model: str = ""                # one-line description of how the company makes money
    moat_types: list[str] = Field(default_factory=list)   # BRAND/NETWORK/SWITCHING/COST/SCALE
    moat_width: Literal["wide", "narrow", "none"] = "narrow"
    moat_trend: Literal["strengthening", "stable", "eroding"] = "stable"
    moat_durability_years: int = 0
    owner_earnings_per_share: float = 0.0   # FCF proxy
    reinvestment_runway: str = ""           # can the company deploy capital at high ROIC?
    management_quality: Literal["excellent", "good", "mediocre", "poor"] = "good"
    capital_allocation: str = ""            # buyback/M&A/dividend discipline
    key_strengths: list[str] = Field(default_factory=list)
    key_weaknesses: list[str] = Field(default_factory=list)
    summary: str = ""


# ── Skill 2: Growth & Scuttlebutt (Fisher 15 Points) ─────────────────────

class FisherFifteenOutput(BaseModel):
    scores: dict = Field(default_factory=dict)  # {"G1": 0.8, "G2": 0.9, ...} 0-1 each
    fisher_total: float = 0.0               # 0–15 sum
    growth_verdict: Literal["compounder", "cyclical", "declining", "turnaround"] = "cyclical"
    revenue_cagr_3yr: float = 0.0           # estimated 3yr CAGR
    tam_assessment: str = ""                # Total Addressable Market outlook
    management_candor_score: int = 5        # 0–10
    green_flags: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    summary: str = ""


# ── Skill 3: Risk Audit & Mental Models (Munger) ─────────────────────────

class MungerRiskOutput(BaseModel):
    critical_risks: list[dict] = Field(default_factory=list)  # [{type, probability, impact, timeline}]
    lollapalooza_positive: list[str] = Field(default_factory=list)
    lollapalooza_negative: list[str] = Field(default_factory=list)
    checklist_red_flags: list[str] = Field(default_factory=list)
    fatal_scenario: str = ""                # single worst-case narrative
    resilience_score: float = 5.0           # 0–10
    summary: str = ""


# ── Skill 4: Final Verdict ───────────────────────────────────────────────

class VerdictOutput(BaseModel):
    # Part 1: Is this company worth holding long-term?
    quality_verdict: Literal["EXCELLENT", "GOOD", "MEDIOCRE", "POOR"] = "GOOD"
    long_term_hold: bool = False            # would you hold this for 10+ years?
    conviction: float = 0.5                 # 0.0–1.0

    # Part 2: Is the current price reasonable? (only matters if quality is good)
    price_assessment: Literal["cheap", "fair", "expensive", "bubble"] = "fair"
    reasoning: str = ""                     # why this price assessment

    # Actionable output
    action: Literal["BUY", "WATCH", "AVOID"] = "WATCH"
    hold_horizon: str = "5-10yr"
    sell_triggers: list[str] = Field(default_factory=list)
    philosophy_scores: dict = Field(default_factory=lambda: {
        "buffett": 5, "fisher": 5, "munger": 5
    })
    one_sentence: str = ""


# ── API Request / Response ─────────────────────────────────────────────────

class CompanyAnalyzeRequest(BaseModel):
    symbol: str
    question: Optional[str] = None
    investment_horizon: str = "5-10yr"
    provider: Optional[str] = None
    model: Optional[str] = None


SKILL_SCHEMAS = {
    "moat_assessment":    MoatAssessmentOutput,
    "fisher_fifteen":     FisherFifteenOutput,
    "munger_risk":        MungerRiskOutput,
    "verdict":            VerdictOutput,
}
