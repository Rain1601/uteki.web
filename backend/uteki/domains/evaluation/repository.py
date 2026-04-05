"""
Evaluation domain repository — async SQLAlchemy data access.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import select, func

from uteki.common.database import db_manager
from uteki.domains.evaluation.models import EvaluationRun, EvaluationGateScore

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_id(data: dict) -> dict:
    if "id" not in data:
        data["id"] = str(uuid4())
    data.setdefault("created_at", _now())
    data.setdefault("updated_at", _now())
    return data


def _row_to_dict(row) -> dict:
    if hasattr(row, '__dict__'):
        d = {k: v for k, v in row.__dict__.items() if not k.startswith('_')}
    else:
        d = dict(row._mapping)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


class EvaluationRepository:

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        async with db_manager.get_postgres_session() as session:
            obj = EvaluationRun(**{k: v for k, v in data.items() if hasattr(EvaluationRun, k)})
            session.add(obj)
            await session.flush()
            return _row_to_dict(obj)

    @staticmethod
    async def update(run_id: str, data: dict) -> Optional[dict]:
        async with db_manager.get_postgres_session() as session:
            q = select(EvaluationRun).where(EvaluationRun.id == run_id)
            obj = (await session.execute(q)).scalar_one_or_none()
            if not obj:
                return None
            data["updated_at"] = _now()
            for k, v in data.items():
                if hasattr(EvaluationRun, k):
                    setattr(obj, k, v)
            await session.flush()
            return _row_to_dict(obj)

    @staticmethod
    async def get_by_id(run_id: str) -> Optional[dict]:
        async with db_manager.get_postgres_session() as session:
            q = select(EvaluationRun).where(EvaluationRun.id == run_id)
            obj = (await session.execute(q)).scalar_one_or_none()
            return _row_to_dict(obj) if obj else None

    @staticmethod
    async def list_runs(
        test_type: Optional[str] = None,
        symbol: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[dict], int]:
        async with db_manager.get_postgres_session() as session:
            base = select(EvaluationRun)
            count_q = select(func.count()).select_from(EvaluationRun)

            if test_type:
                base = base.where(EvaluationRun.test_type == test_type)
                count_q = count_q.where(EvaluationRun.test_type == test_type)
            if symbol:
                base = base.where(EvaluationRun.symbol == symbol.upper())
                count_q = count_q.where(EvaluationRun.symbol == symbol.upper())

            total = (await session.execute(count_q)).scalar() or 0
            q = base.order_by(EvaluationRun.created_at.desc()).offset(skip).limit(limit)
            rows = (await session.execute(q)).scalars().all()

            return [_row_to_dict(r) for r in rows], total


class GateScoreRepository:

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        async with db_manager.get_postgres_session() as session:
            obj = EvaluationGateScore(**{k: v for k, v in data.items() if hasattr(EvaluationGateScore, k)})
            session.add(obj)
            await session.flush()
            return _row_to_dict(obj)

    @staticmethod
    async def get_by_analysis(analysis_id: str) -> List[dict]:
        async with db_manager.get_postgres_session() as session:
            q = (
                select(EvaluationGateScore)
                .where(EvaluationGateScore.analysis_id == analysis_id)
                .order_by(EvaluationGateScore.gate_number)
            )
            rows = (await session.execute(q)).scalars().all()
            return [_row_to_dict(r) for r in rows]
