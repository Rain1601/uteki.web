"""Unified cache service: Redis primary, in-memory fallback."""

import json
import logging
import time
from typing import Any, Callable, Coroutine, Dict, Optional

logger = logging.getLogger(__name__)


class CacheService:
    """Unified cache: Redis primary, in-memory fallback.

    Key convention: ``uteki:{domain}:{operation}:{params}``
    """

    def __init__(self, redis_client=None):
        self._redis = redis_client
        self._local: Dict[str, Dict] = {}  # key -> {"data": str, "ts": float, "ttl": int}

    async def get(self, key: str) -> Optional[Any]:
        """Get cached value. Returns None on miss or expiry."""
        # Try Redis first
        if self._redis is not None:
            try:
                raw = await self._redis.get(key)
                if raw is not None:
                    return json.loads(raw)
            except Exception as e:
                logger.debug(f"Redis GET failed for {key}: {e}")

        # Fallback to local
        entry = self._local.get(key)
        if entry and (time.time() - entry["ts"]) < entry["ttl"]:
            return json.loads(entry["data"])

        # Expired — clean up
        if entry:
            del self._local[key]
        return None

    async def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        """Set cached value with TTL (seconds)."""
        serialized = json.dumps(value)

        # Try Redis
        if self._redis is not None:
            try:
                await self._redis.set(key, serialized, ex=ttl)
            except Exception as e:
                logger.debug(f"Redis SET failed for {key}: {e}")

        # Always set local as fallback
        self._local[key] = {"data": serialized, "ts": time.time(), "ttl": ttl}

    async def delete(self, key: str) -> None:
        """Delete a cached key."""
        if self._redis is not None:
            try:
                await self._redis.delete(key)
            except Exception as e:
                logger.debug(f"Redis DELETE failed for {key}: {e}")

        self._local.pop(key, None)

    async def delete_pattern(self, prefix: str) -> None:
        """Delete all keys matching prefix (for invalidation)."""
        # Redis: SCAN + DELETE
        if self._redis is not None:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self._redis.scan(
                        cursor=cursor, match=f"{prefix}*", count=100,
                    )
                    if keys:
                        await self._redis.delete(*keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.debug(f"Redis DELETE pattern failed for {prefix}: {e}")

        # Local: filter by prefix
        to_delete = [k for k in self._local if k.startswith(prefix)]
        for k in to_delete:
            del self._local[k]

    async def get_or_set(
        self,
        key: str,
        factory: Callable[[], Coroutine[Any, Any, Any]],
        ttl: "int | Callable[[Any], int]" = 3600,
    ) -> Any:
        """Get cached value or compute via *factory*, cache, and return.

        ``ttl`` can be an int (fixed TTL) or a callable ``(value) -> int``
        evaluated after the factory runs — useful for short-TTL-on-empty
        patterns (e.g. avoid caching an empty monthly list for a full day).
        A TTL of ``0`` or less skips caching.
        """
        cached = await self.get(key)
        if cached is not None:
            return cached

        value = await factory()
        actual_ttl = ttl(value) if callable(ttl) else ttl
        if actual_ttl and actual_ttl > 0:
            await self.set(key, value, ttl=actual_ttl)
        return value


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_cache_service: Optional[CacheService] = None


def init_cache_service(redis_client=None) -> CacheService:
    """Initialize the global CacheService (called during app startup)."""
    global _cache_service
    _cache_service = CacheService(redis_client=redis_client)
    logger.info(
        "CacheService initialized (%s)",
        "Redis + in-memory" if redis_client else "in-memory only",
    )
    return _cache_service


def get_cache_service() -> CacheService:
    """Return the global CacheService instance (lazy-init if needed)."""
    global _cache_service
    if _cache_service is None:
        _cache_service = CacheService()
        logger.warning("CacheService accessed before init — using in-memory only")
    return _cache_service
