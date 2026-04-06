"""Agent 记忆服务 — Supabase REST API 版（含 PostgreSQL fallback）"""

import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from uuid import uuid4

from sqlalchemy import select

from uteki.common.database import SupabaseRepository, db_manager
from uteki.domains.index.models.agent_memory import AgentMemory

logger = logging.getLogger(__name__)

TABLE = "agent_memory"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_id(data: dict) -> dict:
    """Ensure dict has id + timestamps for a new row."""
    if "id" not in data:
        data["id"] = str(uuid4())
    data.setdefault("created_at", _now_iso())
    data.setdefault("updated_at", _now_iso())
    return data


async def _backup_rows(rows: list):
    """Best-effort SQLite backup (failure only warns)."""
    try:
        async with db_manager.get_postgres_session() as session:
            for row in rows:
                safe = {k: v for k, v in row.items() if hasattr(AgentMemory, k)}
                await session.merge(AgentMemory(**safe))
    except Exception as e:
        logger.warning(f"SQLite backup failed for {TABLE}: {e}")


class MemoryService:
    """Agent 记忆读写 — 支持 per-agent 私有记忆 + 共享记忆"""

    def __init__(self):
        self.repo = SupabaseRepository(TABLE)

    async def write(
        self,
        user_id: str,
        category: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        agent_key: str = "shared",
    ) -> Dict[str, Any]:
        """写入一条记忆"""
        data = {
            "user_id": user_id,
            "category": category,
            "content": content,
            "metadata": metadata,
            "agent_key": agent_key,
        }
        _ensure_id(data)
        result = self.repo.insert(data)
        row = result.data[0] if result.data else data
        await _backup_rows([row])
        return row

    async def read(
        self,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
        agent_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """读取记忆，按 category + agent_key 过滤 + 时间倒序（分页）

        Args:
            agent_key: None=不过滤, "shared"=仅共享, 具体key=仅该agent
        """
        if not db_manager.supabase_available:
            return await self._read_from_postgres(user_id, category, limit, offset, agent_key)

        filters: Dict[str, Any] = {"user_id": user_id}
        if category:
            filters["category"] = category
        if agent_key is not None:
            filters["agent_key"] = agent_key

        return self.repo.select_data(
            eq=filters, order="created_at.desc", limit=limit, offset=offset,
        )

    async def _read_from_postgres(
        self,
        user_id: str,
        category: Optional[str],
        limit: int,
        offset: int,
        agent_key: Optional[str],
    ) -> List[Dict[str, Any]]:
        """PostgreSQL fallback for read when Supabase is unavailable."""
        async with db_manager.get_postgres_session() as session:
            stmt = select(AgentMemory).where(AgentMemory.user_id == user_id)
            if category:
                stmt = stmt.where(AgentMemory.category == category)
            if agent_key is not None:
                stmt = stmt.where(AgentMemory.agent_key == agent_key)
            stmt = stmt.order_by(AgentMemory.created_at.desc()).offset(offset).limit(limit)
            result = await session.execute(stmt)
            return [row.to_dict() for row in result.scalars()]

    async def get_summary(
        self,
        user_id: str,
        agent_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """获取 Harness 构建所需的记忆摘要

        Args:
            agent_key: 如果指定，返回 shared 记忆 + 该 agent 的私有记忆 + 最近投票获胜方案

        返回:
        - recent_decisions: 最近 3 条 decision
        - recent_reflection: 最近 1 条 reflection
        - experiences: 所有 experience (通常 < 20)
        - recent_voting_winners: 最近 3 条投票获胜方案
        - agent_private_memories: 该 agent 的私有记忆（如果 agent_key 指定）
        """
        # 共享记忆（所有 agent 共用）
        decisions = await self.read(
            user_id, category="decision", limit=3, agent_key="shared"
        )
        reflections = await self.read(
            user_id, category="reflection", limit=1, agent_key="shared"
        )
        experiences = await self.read(
            user_id, category="experience", limit=50, agent_key="shared"
        )

        # 投票获胜方案（共享记忆中的 arena_learning 类别）
        voting_winners = await self.read(
            user_id, category="arena_learning", limit=3, agent_key="shared"
        )
        recent_voting_winners = [w.get("content", "")[:200] for w in voting_winners]

        summary: Dict[str, Any] = {
            "recent_decisions": decisions,
            "recent_reflection": reflections[0] if reflections else None,
            "experiences": experiences,
            "recent_voting_winners": recent_voting_winners,
        }

        # Per-agent 私有记忆
        if agent_key and agent_key != "shared":
            private_memories = await self.read(
                user_id, limit=10, agent_key=agent_key
            )
            summary["agent_private_memories"] = private_memories

        return summary

    async def delete(
        self,
        memory_id: str,
        user_id: str,
    ) -> bool:
        """删除一条记忆"""
        result = self.repo.delete(eq={"id": memory_id, "user_id": user_id})
        return bool(result.data)

    async def write_arena_learning(
        self,
        user_id: str,
        winner_summary: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """写入投票获胜方案到共享记忆"""
        return await self.write(
            user_id=user_id,
            category="arena_learning",
            content=winner_summary,
            metadata=metadata,
            agent_key="shared",
        )

    async def write_vote_reasoning(
        self,
        user_id: str,
        agent_key: str,
        reasoning: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """写入 agent 的投票理由到私有记忆"""
        return await self.write(
            user_id=user_id,
            category="arena_vote_reasoning",
            content=reasoning,
            metadata=metadata,
            agent_key=agent_key,
        )


    async def compress_if_needed(
        self,
        user_id: str,
        max_experiences: int = 30,
        compress_to: int = 10,
    ) -> Optional[str]:
        """Compress old experience memories when count exceeds threshold.

        When experiences > max_experiences:
        1. Keep the newest `compress_to` experiences
        2. Summarize the rest into a single consolidated memory
        3. Delete the old individual memories

        Returns the consolidated memory content, or None if no compression needed.
        """
        experiences = await self.read(
            user_id, category="experience", limit=200, agent_key="shared"
        )

        if len(experiences) <= max_experiences:
            return None

        # Split: keep recent, compress old
        recent = experiences[:compress_to]
        old = experiences[compress_to:]

        # Build summary from old memories (no LLM needed — just concatenate key points)
        old_contents = [m.get("content", "")[:150] for m in old]
        summary_lines = []
        for i, content in enumerate(old_contents):
            summary_lines.append(f"- {content}")
            if i >= 49:  # cap at 50 items in summary
                summary_lines.append(f"... and {len(old_contents) - 50} more")
                break

        consolidated = (
            f"[Consolidated from {len(old)} memories, "
            f"oldest: {old[-1].get('created_at', '?')[:10]}]\n"
            + "\n".join(summary_lines)
        )

        # Write consolidated memory
        await self.write(
            user_id=user_id,
            category="experience",
            content=consolidated,
            metadata={"consolidated_count": len(old), "type": "compressed"},
            agent_key="shared",
        )

        # Delete old individual memories
        for m in old:
            mid = m.get("id")
            if mid:
                try:
                    await self.delete(mid, user_id)
                except Exception as e:
                    logger.warning(f"Failed to delete memory {mid}: {e}")

        logger.info(
            f"[memory] Compressed {len(old)} experiences → 1 consolidated + "
            f"{len(recent)} recent for user {user_id}"
        )
        return consolidated


_memory_service: Optional[MemoryService] = None


def get_memory_service() -> MemoryService:
    global _memory_service
    if _memory_service is None:
        _memory_service = MemoryService()
    return _memory_service
