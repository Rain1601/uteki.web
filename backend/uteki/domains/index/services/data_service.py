"""指数数据服务 — FMP 为主, Alpha Vantage 为备 (Supabase REST API)"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from uuid import uuid4

import httpx

from uteki.common.cache import get_cache_service
from uteki.common.config import settings
from uteki.common.database import SupabaseRepository, db_manager

logger = logging.getLogger(__name__)

# 预设观察池
DEFAULT_WATCHLIST = [
    {
        "symbol": "VOO", "name": "Vanguard S&P 500 ETF", "etf_type": "broad_market",
        "notes": "追踪标普500指数，费率0.03%，是最受欢迎的被动指数基金之一。适合作为美股核心配置，长期年化回报约10%。Vanguard旗舰产品，流动性极强。",
    },
    {
        "symbol": "IVV", "name": "iShares Core S&P 500 ETF", "etf_type": "broad_market",
        "notes": "iShares版标普500 ETF，费率0.03%，与VOO几乎相同。BlackRock旗下产品，AUM规模略大于VOO，适合作为VOO的替代选择。",
    },
    {
        "symbol": "QQQ", "name": "Invesco QQQ Trust", "etf_type": "nasdaq100",
        "notes": "追踪纳斯达克100指数，重仓科技股（苹果、微软、英伟达等），费率0.20%。波动性高于标普500，但长期回报也更高。适合看好科技板块的投资者。",
    },
    {
        "symbol": "ACWI", "name": "iShares MSCI ACWI ETF", "etf_type": "global",
        "notes": "追踪MSCI全球指数（含发达+新兴市场），约60%美股+40%国际。费率0.32%，一只ETF实现全球分散配置。适合不想只押注美股的投资者。",
    },
    {
        "symbol": "VGT", "name": "Vanguard Information Technology ETF", "etf_type": "sector_tech",
        "notes": "Vanguard信息技术板块ETF，费率0.10%，集中持有苹果、微软、英伟达等科技龙头。比QQQ更纯粹的科技板块暴露，波动性更大。",
    },
]

FMP_BASE_URL = "https://financialmodelingprep.com/stable"
AV_BASE_URL = "https://www.alphavantage.co/query"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

INDEX_PRICE_TABLE = "index_prices"
WATCHLIST_TABLE = "watchlist"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_id(data: dict) -> dict:
    """Ensure dict has id + timestamps for a new row."""
    if "id" not in data:
        data["id"] = str(uuid4())
    data.setdefault("created_at", _now_iso())
    data.setdefault("updated_at", _now_iso())
    return data


async def _backup_price_rows(rows: list):
    try:
        from uteki.domains.index.models.index_price import IndexPrice
        async with db_manager.get_postgres_session() as session:
            for row in rows:
                safe = {k: v for k, v in row.items() if hasattr(IndexPrice, k)}
                await session.merge(IndexPrice(**safe))
    except Exception as e:
        logger.warning(f"SQLite backup failed for index_prices: {e}")


async def _backup_watchlist_rows(rows: list):
    try:
        from uteki.domains.index.models.watchlist import Watchlist
        async with db_manager.get_postgres_session() as session:
            for row in rows:
                safe = {k: v for k, v in row.items() if hasattr(Watchlist, k)}
                await session.merge(Watchlist(**safe))
    except Exception as e:
        logger.warning(f"SQLite backup failed for watchlist: {e}")


def _parse_date(value) -> date:
    """Parse a date value that may be a string or a date object."""
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


class DataService:
    """指数 ETF 数据获取与存储服务"""

    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None
        self.price_repo = SupabaseRepository(INDEX_PRICE_TABLE)
        self.watchlist_repo = SupabaseRepository(WATCHLIST_TABLE)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    # ── Quote (real-time / near-real-time) ──

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """获取 ETF 实时报价，FMP 为主，AV 为备，最终 fallback 到 DB 缓存"""
        cache = get_cache_service()
        cache_key = f"uteki:index:quote:{symbol}"

        cached = await cache.get(cache_key)
        if cached:
            return cached

        quote = await self._fetch_quote_fmp(symbol)
        if quote:
            await cache.set(cache_key, quote, ttl=300)
            return quote

        quote = await self._fetch_quote_av(symbol)
        if quote:
            await cache.set(cache_key, quote, ttl=300)
            return quote

        # Fallback: 从 DB 取最近一条价格
        return self._get_cached_quote(symbol)

    async def _fetch_quote_fmp(self, symbol: str) -> Optional[Dict[str, Any]]:
        if not settings.fmp_api_key:
            return None
        try:
            client = await self._get_client()
            resp = await client.get(
                f"{FMP_BASE_URL}/quote",
                params={"symbol": symbol, "apikey": settings.fmp_api_key},
            )
            if resp.status_code == 429:
                logger.warning("FMP rate limit exceeded, falling back to AV")
                return None
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return None
            q = data[0] if isinstance(data, list) else data
            return {
                "symbol": symbol,
                "price": q.get("price"),
                "change_pct": q.get("changePercentage"),
                "pe_ratio": q.get("pe"),
                "market_cap": q.get("marketCap"),
                "volume": q.get("volume"),
                "high_52w": q.get("yearHigh"),
                "low_52w": q.get("yearLow"),
                "ma50": q.get("priceAvg50"),
                "ma200": q.get("priceAvg200"),
                "rsi": None,  # FMP quote 不含 RSI，需从历史数据计算
                "timestamp": q.get("timestamp"),
                "stale": False,
                "today_open": q.get("open"),
                "today_high": q.get("dayHigh"),
                "today_low": q.get("dayLow"),
                "previous_close": q.get("previousClose"),
            }
        except Exception as e:
            logger.error(f"FMP quote error for {symbol}: {e}")
            return None

    async def _fetch_quote_av(self, symbol: str) -> Optional[Dict[str, Any]]:
        if not settings.alpha_vantage_api_key:
            return None
        try:
            client = await self._get_client()
            resp = await client.get(
                AV_BASE_URL,
                params={
                    "function": "GLOBAL_QUOTE",
                    "symbol": symbol,
                    "apikey": settings.alpha_vantage_api_key,
                },
            )
            resp.raise_for_status()
            data = resp.json().get("Global Quote", {})
            if not data:
                return None
            price = float(data.get("05. price", 0))
            prev_close = float(data.get("08. previous close", 0))
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close else None
            return {
                "symbol": symbol,
                "price": price,
                "change_pct": change_pct,
                "pe_ratio": None,
                "market_cap": None,
                "volume": int(data.get("06. volume", 0)),
                "high_52w": None,
                "low_52w": None,
                "ma50": None,
                "ma200": None,
                "rsi": None,
                "timestamp": data.get("07. latest trading day"),
                "stale": False,
                # AV GLOBAL_QUOTE includes open/high/low
                "today_open": float(data.get("02. open", 0)) or None,
                "today_high": float(data.get("03. high", 0)) or None,
                "today_low": float(data.get("04. low", 0)) or None,
                "previous_close": prev_close or None,
            }
        except Exception as e:
            logger.error(f"AV quote error for {symbol}: {e}")
            return None

    def _get_cached_quote(self, symbol: str) -> Dict[str, Any]:
        """从 DB 取最近缓存价格"""
        row = self.price_repo.select_one(
            eq={"symbol": symbol},
            order="date.desc",
        )
        if row:
            return {
                "symbol": symbol,
                "price": row.get("close"),
                "change_pct": None,
                "pe_ratio": None,
                "market_cap": None,
                "volume": row.get("volume"),
                "high_52w": None,
                "low_52w": None,
                "ma50": None,
                "ma200": None,
                "rsi": None,
                "timestamp": row.get("date"),
                "stale": True,
                # Cached data has OHLC from DB
                "today_open": row.get("open"),
                "today_high": row.get("high"),
                "today_low": row.get("low"),
                "previous_close": None,
            }
        return {"symbol": symbol, "price": None, "stale": True, "error": "No data available"}

    # ── Historical data ──

    def get_history(
        self,
        symbol: str,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """获取历史日线数据，优先从 DB 读取"""
        eq = {"symbol": symbol}
        gte = {"date": start} if start else None
        lte = {"date": end} if end else None

        rows = self.price_repo.select_data(
            eq=eq,
            gte=gte,
            lte=lte,
            order="date.asc",
        )
        return rows

    async def fetch_and_store_history(
        self,
        symbol: str,
        from_date: Optional[str] = None,
    ) -> int:
        """从 FMP stable 拉取历史数据并存入 DB，返回新增条数"""
        if not settings.fmp_api_key:
            logger.warning("FMP API key not set, skipping history fetch")
            return 0

        try:
            client = await self._get_client()
            params: Dict[str, Any] = {
                "symbol": symbol,
                "apikey": settings.fmp_api_key,
            }
            if from_date:
                params["from"] = from_date

            resp = await client.get(
                f"{FMP_BASE_URL}/historical-price-eod/full",
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
            # Stable endpoint returns flat array (not nested under "historical")
            historical = data if isinstance(data, list) else data.get("historical", [])
            if not historical:
                return 0

            batch = []
            for item in historical:
                try:
                    price_date_str = str(item["date"])[:10]
                    # Check if record already exists
                    existing = self.price_repo.select_one(
                        eq={"symbol": symbol, "date": price_date_str},
                    )
                    if existing:
                        continue  # Skip existing record

                    row = _ensure_id({
                        "symbol": symbol,
                        "date": price_date_str,
                        "open": item["open"],
                        "high": item["high"],
                        "low": item["low"],
                        "close": item["close"],
                        "volume": item.get("volume", 0),
                    })
                    batch.append(row)
                except Exception as e:
                    logger.warning(f"Skip price row {symbol}/{item.get('date')}: {e}")

            if batch:
                self.price_repo.upsert(batch)
                await _backup_price_rows(batch)

            count = len(batch)
            logger.info(f"Stored {count} price records for {symbol}")
            return count
        except Exception as e:
            logger.error(f"FMP history fetch error for {symbol}: {e}")
            return 0

    async def initial_history_load(self, symbol: str) -> int:
        """初始加载：拉取最近 5 年历史数据"""
        five_years_ago = (date.today() - timedelta(days=5 * 365)).isoformat()
        return await self.fetch_and_store_history(symbol, from_date=five_years_ago)

    async def incremental_update(self, symbol: str) -> int:
        """增量更新：只拉取缺失的日期"""
        rows = self.price_repo.select_data(
            eq={"symbol": symbol},
            order="date.desc",
            limit=1,
        )

        if rows:
            last_date = _parse_date(rows[0]["date"])
            from_date = (last_date + timedelta(days=1)).isoformat()
        else:
            from_date = (date.today() - timedelta(days=5 * 365)).isoformat()

        return await self.fetch_and_store_history(symbol, from_date=from_date)

    async def incremental_update_with_retry(
        self, symbol: str, max_retries: int = 3
    ) -> Dict[str, Any]:
        """带重试的增量更新"""
        last_error = None
        for attempt in range(max_retries):
            try:
                count = await self.incremental_update(symbol)
                return {"symbol": symbol, "status": "success", "records": count}
            except Exception as e:
                last_error = str(e)
                logger.warning(f"Retry {attempt + 1}/{max_retries} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff

        logger.error(f"Failed to update {symbol} after {max_retries} retries: {last_error}")
        return {"symbol": symbol, "status": "failed", "error": last_error}

    async def smart_backfill(
        self, symbol: str, lookback_days: int = 30
    ) -> Dict[str, Any]:
        """
        智能回填：检测最近 N 天内的缺失交易日并补齐
        用于处理：任务漏执行、同步失败等场景
        """
        # 1. 验证数据连续性
        validation = self.validate_data_continuity(symbol)

        if not validation.get("last_date"):
            # 无数据，执行初始加载
            count = await self.initial_history_load(symbol)
            return {
                "symbol": symbol,
                "action": "initial_load",
                "records": count,
            }

        # 2. 检查是否有缺失日期（仅看最近 lookback_days 天）
        last_date = _parse_date(validation["last_date"])
        cutoff_date = date.today() - timedelta(days=lookback_days)
        recent_missing = [
            d for d in validation.get("missing_dates", [])
            if _parse_date(d) >= cutoff_date
        ]

        # 3. 检查是否落后于当前日期（排除周末、假日和今天）
        from uteki.domains.index.services.market_calendar import is_trading_day
        today = date.today()
        days_behind = 0
        check_date = last_date + timedelta(days=1)
        while check_date < today:
            if is_trading_day(check_date):
                days_behind += 1
            check_date += timedelta(days=1)

        # 4. 执行回填
        if recent_missing or days_behind > 0:
            # 从缺失日期的最早一天开始重新拉取
            if recent_missing:
                earliest_missing = min(_parse_date(d) for d in recent_missing)
                from_date = (earliest_missing - timedelta(days=1)).isoformat()
            else:
                from_date = last_date.isoformat()

            count = await self.fetch_and_store_history(symbol, from_date=from_date)
            return {
                "symbol": symbol,
                "action": "backfill",
                "records": count,
                "missing_filled": len(recent_missing),
                "days_behind": days_behind,
            }

        return {
            "symbol": symbol,
            "action": "up_to_date",
            "records": 0,
        }

    async def update_all_watchlist(self) -> Dict[str, int]:
        """更新观察池内所有 active symbol 的数据"""
        watchlist_rows = self.watchlist_repo.select_data(
            eq={"is_active": True},
        )

        results = {}
        for w in watchlist_rows:
            count = await self.incremental_update(w["symbol"])
            results[w["symbol"]] = count

        return results

    async def robust_update_all(
        self, validate: bool = True, backfill: bool = True
    ) -> Dict[str, Any]:
        """
        健壮的全量更新：带重试、回填、验证
        用于调度任务，处理各种异常场景
        """
        watchlist_rows = self.watchlist_repo.select_data(
            eq={"is_active": True},
        )

        results = {
            "success": [],
            "failed": [],
            "backfilled": [],
            "anomalies": [],
            "total_records": 0,
        }

        for w in watchlist_rows:
            symbol = w["symbol"]

            # 1. 智能回填（检测并补齐缺失数据）
            if backfill:
                backfill_result = await self.smart_backfill(symbol)
                if backfill_result["action"] == "backfill":
                    results["backfilled"].append(backfill_result)
                    results["total_records"] += backfill_result.get("records", 0)
                    logger.info(
                        f"Backfilled {symbol}: {backfill_result.get('records', 0)} records, "
                        f"filled {backfill_result.get('missing_filled', 0)} missing days"
                    )
                    continue  # 已回填，跳过增量更新

            # 2. 带重试的增量更新
            update_result = await self.incremental_update_with_retry(symbol)

            if update_result["status"] == "success":
                results["success"].append(symbol)
                results["total_records"] += update_result.get("records", 0)
            else:
                results["failed"].append({
                    "symbol": symbol,
                    "error": update_result.get("error"),
                })

            # 3. 数据验证（检测异常价格）
            if validate and update_result["status"] == "success":
                anomalies = self.validate_prices(symbol)
                if anomalies:
                    results["anomalies"].extend(anomalies)

        # 汇总日志
        logger.info(
            f"Robust update completed: "
            f"{len(results['success'])} success, "
            f"{len(results['failed'])} failed, "
            f"{len(results['backfilled'])} backfilled, "
            f"{len(results['anomalies'])} anomalies detected, "
            f"{results['total_records']} total records"
        )

        return results

    # ── Data validation ──

    def validate_prices(self, symbol: str) -> List[Dict[str, Any]]:
        """验证价格数据：检测异常波动（>20%）"""
        rows = self.price_repo.select_data(
            eq={"symbol": symbol},
            order="date.asc",
        )

        anomalies = []
        for i in range(1, len(rows)):
            prev_close = rows[i - 1].get("close", 0)
            curr_close = rows[i].get("close", 0)
            if prev_close and prev_close > 0:
                change_pct = abs((curr_close - prev_close) / prev_close * 100)
                if change_pct > 20:
                    row_date = rows[i].get("date", "")
                    anomalies.append({
                        "symbol": symbol,
                        "date": str(row_date)[:10],
                        "prev_close": prev_close,
                        "close": curr_close,
                        "change_pct": round(change_pct, 2),
                        "needs_review": True,
                    })
                    logger.warning(
                        f"Price anomaly: {symbol} {row_date} "
                        f"changed {change_pct:.1f}% from {prev_close} to {curr_close}"
                    )
        return anomalies

    # ── Technical indicators ──

    def get_indicators(self, symbol: str) -> Dict[str, Any]:
        """计算技术指标：MA50, MA200, RSI(14)"""
        rows = self.price_repo.select_data(
            eq={"symbol": symbol},
            order="date.desc",
            limit=250,  # 足够计算 MA200 + RSI
        )
        # Reverse so oldest first (select was desc for limit)
        rows = list(reversed(rows))

        if not rows:
            return {"symbol": symbol, "ma50": None, "ma200": None, "rsi": None}

        closes = [r.get("close", 0) for r in rows]

        ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
        ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
        rsi = self._calculate_rsi(closes, 14) if len(closes) >= 15 else None

        return {
            "symbol": symbol,
            "ma50": round(ma50, 2) if ma50 else None,
            "ma200": round(ma200, 2) if ma200 else None,
            "rsi": round(rsi, 2) if rsi else None,
        }

    @staticmethod
    def _calculate_rsi(closes: List[float], period: int = 14) -> Optional[float]:
        if len(closes) < period + 1:
            return None
        gains = []
        losses = []
        for i in range(1, len(closes)):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))

        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period

        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    # ── Data Continuity Validation ──

    def validate_data_continuity(self, symbol: str) -> Dict[str, Any]:
        """
        验证数据连续性：检测缺失的交易日（排除周末）
        Returns: {symbol, is_valid, missing_dates, first_date, last_date, total_records}
        """
        rows = self.price_repo.select_data(
            eq={"symbol": symbol},
            order="date.asc",
        )

        if not rows:
            return {
                "symbol": symbol,
                "is_valid": False,
                "missing_dates": [],
                "first_date": None,
                "last_date": None,
                "total_records": 0,
                "error": "No data available",
            }

        dates = [_parse_date(r["date"]) for r in rows]

        missing_dates = []
        first_date = dates[0]
        last_date = dates[-1]
        date_set = set(dates)

        # Check each day between first and last date
        from uteki.domains.index.services.market_calendar import is_trading_day
        current = first_date
        while current <= last_date:
            # Skip weekends and US market holidays
            if is_trading_day(current) and current not in date_set:
                missing_dates.append(current.isoformat())
                logger.warning(f"Missing trading day for {symbol}: {current.isoformat()}")
            current += timedelta(days=1)

        is_valid = len(missing_dates) == 0

        return {
            "symbol": symbol,
            "is_valid": is_valid,
            "missing_dates": missing_dates,
            "first_date": first_date.isoformat(),
            "last_date": last_date.isoformat(),
            "total_records": len(dates),
        }

    def validate_all_watchlist(self) -> Dict[str, Dict[str, Any]]:
        """验证观察池内所有 symbol 的数据连续性"""
        watchlist_rows = self.watchlist_repo.select_data(
            eq={"is_active": True},
        )

        results = {}
        for w in watchlist_rows:
            symbol = w["symbol"]
            validation = self.validate_data_continuity(symbol)
            results[symbol] = validation
            if not validation["is_valid"]:
                logger.warning(
                    f"Data gaps detected for {symbol}: {len(validation['missing_dates'])} missing days"
                )

        return results

    # ── Watchlist CRUD ──

    def get_watchlist(self, active_only: bool = True) -> List[Dict[str, Any]]:
        eq = {"is_active": True} if active_only else None
        return self.watchlist_repo.select_data(
            eq=eq,
            order="created_at.asc",
        )

    async def add_to_watchlist(
        self, symbol: str,
        name: Optional[str] = None, etf_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """添加到观察池，触发历史数据加载"""
        # 检查是否已存在
        existing = self.watchlist_repo.select_one(
            eq={"symbol": symbol.upper()},
        )

        if existing:
            if not existing.get("is_active"):
                self.watchlist_repo.update(
                    data={"is_active": True, "updated_at": _now_iso()},
                    eq={"id": existing["id"]},
                )
                existing["is_active"] = True
                await _backup_watchlist_rows([existing])
            return existing

        new_item = _ensure_id({
            "symbol": symbol.upper(),
            "name": name,
            "etf_type": etf_type,
            "is_active": True,
        })
        result = self.watchlist_repo.upsert(new_item)
        row = result.data[0] if result.data else new_item
        await _backup_watchlist_rows([row])

        # Load historical data in background thread to avoid blocking event loop
        import asyncio
        asyncio.get_event_loop().run_in_executor(
            None,
            lambda: asyncio.run(self.initial_history_load(symbol.upper()))
        )

        return row

    async def remove_from_watchlist(self, symbol: str) -> bool:
        """从观察池移除（标记为 inactive，保留数据）"""
        existing = self.watchlist_repo.select_one(
            eq={"symbol": symbol.upper()},
        )
        if existing:
            self.watchlist_repo.update(
                data={"is_active": False, "updated_at": _now_iso()},
                eq={"id": existing["id"]},
            )
            existing["is_active"] = False
            await _backup_watchlist_rows([existing])
            return True
        return False

    async def seed_default_watchlist(self) -> int:
        """预设默认观察池（仅当池为空时）"""
        result = self.watchlist_repo.select("*", count="exact")
        if result.count and result.count > 0:
            return 0

        batch = []
        for item in DEFAULT_WATCHLIST:
            row = _ensure_id({
                "symbol": item["symbol"],
                "name": item["name"],
                "etf_type": item["etf_type"],
                "notes": item.get("notes"),
                "is_active": True,
            })
            batch.append(row)

        if batch:
            self.watchlist_repo.upsert(batch)
            await _backup_watchlist_rows(batch)

        logger.info(f"Seeded {len(batch)} default watchlist items")
        return len(batch)


# Singleton
_data_service: Optional[DataService] = None


def get_data_service() -> DataService:
    global _data_service
    if _data_service is None:
        _data_service = DataService()
    return _data_service
