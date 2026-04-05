"""
Evaluation domain — Pydantic schemas.
"""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional


class ConsistencyTestRequest(BaseModel):
    symbol: str
    num_runs: int = Field(default=3, ge=2, le=10)
    model: Optional[str] = None  # None = auto-select


class JudgeRequest(BaseModel):
    judge_model: Optional[str] = None  # None = deepseek-chat
