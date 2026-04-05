"""
Evaluation domain models — persistent storage for evaluation runs.
"""
from sqlalchemy import String, Integer, Index, JSON, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional, Dict, Any, List

from uteki.common.base import Base, TimestampMixin, UUIDMixin, get_table_args


class EvaluationRun(Base, UUIDMixin, TimestampMixin):
    """
    One evaluation run — e.g. a consistency test with N pipeline executions.
    """

    __tablename__ = "evaluation_runs"
    __table_args__ = get_table_args(
        Index("idx_eval_type", "test_type"),
        Index("idx_eval_symbol", "symbol"),
        schema="evaluation"
    )

    test_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "consistency"
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    num_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")

    # Array of per-run results
    runs_data: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)

    # Computed consistency metrics
    metrics: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self):
        return f"<EvaluationRun(id={self.id}, type={self.test_type}, symbol={self.symbol}, status={self.status})>"
