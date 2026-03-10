"""Index Scheduler - 指数数据每日更新调度

启动时检测 DB 中 daily_price_update 任务的 last_run_at：
  - 若不是今天 → 立即补执行
  - 每次执行后更新 last_run_at + last_run_status
  - 执行前检查当天是否已跑过，防止重复
"""

import asyncio
import logging
from datetime import datetime, date, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from uteki.common.database import db_manager
from uteki.domains.index.services.data_service import get_data_service

logger = logging.getLogger(__name__)

TASK_NAME = "daily_price_update"


class IndexScheduler:
    """指数数据调度器 — 每日K线更新"""

    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self._is_running = False
        self._last_run: Optional[datetime] = None
        self._last_result: Optional[dict] = None

    def initialize(self):
        if self.scheduler is not None:
            return

        self.scheduler = AsyncIOScheduler(
            timezone='UTC',
            job_defaults={
                'coalesce': True,
                'max_instances': 1,
                'misfire_grace_time': 600,
            }
        )

        # 每日 UTC 05:00 (美东 0:00) 更新K线数据
        self.scheduler.add_job(
            self._daily_price_update_job,
            trigger=CronTrigger(hour=5, minute=0),
            id='index_daily_price_update',
            name='Index Daily Price Update (UTC 05:00)',
            replace_existing=True,
        )

        logger.info("Index scheduler initialized")

    def start(self):
        if self.scheduler is None:
            self.initialize()

        if not self._is_running:
            self.scheduler.start()
            self._is_running = True
            logger.info("Index scheduler started")

            # 启动时检查是否需要补执行
            asyncio.create_task(self._check_and_catchup())

    def stop(self):
        if self.scheduler and self._is_running:
            self.scheduler.shutdown(wait=False)
            self._is_running = False
            logger.info("Index scheduler stopped")

    # ── DB 持久化 ──

    async def _get_or_seed_task(self) -> Optional[dict]:
        """获取 DB 中的 daily_price_update 任务，不存在则创建"""
        from uteki.domains.index.services.scheduler_service import get_scheduler_service
        sched_svc = get_scheduler_service()

        tasks = await sched_svc.list_tasks()
        for t in tasks:
            if t["name"] == TASK_NAME:
                return t

        # Seed
        task = await sched_svc.create_task(
            name=TASK_NAME,
            cron_expression="0 5 * * *",
            task_type="price_update",
            config={"validate_after_update": True, "enable_backfill": True},
        )
        logger.info(f"Seeded {TASK_NAME} schedule task: {task['id']}")
        return task

    async def _update_run_status(self, task_id: str, status: str):
        """更新 DB 中的 last_run_at 和 last_run_status"""
        from uteki.domains.index.services.scheduler_service import get_scheduler_service
        sched_svc = get_scheduler_service()

        await sched_svc.update_run_status(task_id, status)

    async def _is_already_run_today(self) -> bool:
        """检查今天是否已经执行过"""
        task = await self._get_or_seed_task()
        if not task or not task.get("last_run_at"):
            return False

        last_run_str = task["last_run_at"]
        if isinstance(last_run_str, str):
            last_run_dt = datetime.fromisoformat(last_run_str)
        else:
            last_run_dt = last_run_str

        today_utc = datetime.now(timezone.utc).date()
        return last_run_dt.date() == today_utc

    # ── 启动补执行 ──

    async def _check_and_catchup(self):
        """启动时检查：如果今天还没跑过，延迟 15s 后立即补执行"""
        try:
            await asyncio.sleep(15)  # 等待 DB 就绪

            if not db_manager.postgres_available:
                logger.warning("PostgreSQL not available, skip catchup check")
                return

            already_run = await self._is_already_run_today()
            if already_run:
                logger.info(f"Index price update already ran today, skipping catchup")
                return

            task = await self._get_or_seed_task()
            last_run = task.get("last_run_at") if task else None
            logger.info(f"Index price update not yet run today (last_run={last_run}), running catchup...")
            await self._daily_price_update_job()

        except Exception as e:
            logger.error(f"Index scheduler catchup check failed: {e}", exc_info=True)

    # ── 核心任务 ──

    async def _daily_price_update_job(self):
        """每日K线数据增量更新（带重试、回填、异常检测）"""
        task = None
        try:
            if not db_manager.postgres_available:
                logger.warning("PostgreSQL not available, skipping price update")
                return

            # 再次检查防重复（cron 触发 + catchup 可能重叠）
            already_run = await self._is_already_run_today()
            if already_run:
                logger.info("Index price update already ran today, skipping")
                return

            task = await self._get_or_seed_task()
            logger.info("Starting daily index price update...")
            self._last_run = datetime.now(timezone.utc)

            data_service = get_data_service()
            # Run in thread to prevent synchronous Supabase REST calls
            # from blocking the main asyncio event loop
            import asyncio
            results = await asyncio.to_thread(
                self._run_update_sync, data_service
            )

            has_failures = len(results['failed']) > 0
            status = "partial_failure" if has_failures else "success"

            self._last_result = {
                'success': not has_failures,
                'total_records': results['total_records'],
                'success_count': len(results['success']),
                'failed': results['failed'],
                'backfilled': len(results['backfilled']),
                'anomalies': len(results['anomalies']),
                'run_at': self._last_run.isoformat(),
            }

            if has_failures:
                logger.warning(f"Daily price update partial failure: {results['failed']}")
            else:
                logger.info(
                    f"Daily price update completed: "
                    f"{results['total_records']} records, "
                    f"{len(results['success'])} symbols OK, "
                    f"{len(results['backfilled'])} backfilled"
                )

            # 更新 DB 运行状态
            if task:
                await self._update_run_status(task["id"], status)

        except Exception as e:
            logger.error(f"Daily price update job failed: {e}", exc_info=True)
            self._last_result = {'success': False, 'error': str(e)}
            if task:
                await self._update_run_status(task["id"], "error")

    @staticmethod
    def _run_update_sync(data_service):
        """Run robust_update_all in a new event loop (for use with asyncio.to_thread).
        This allows the synchronous Supabase HTTP calls inside to execute
        without blocking the main event loop."""
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                data_service.robust_update_all(validate=True, backfill=True)
            )
        finally:
            loop.close()

    def get_status(self) -> dict:
        jobs = []
        if self.scheduler:
            for job in self.scheduler.get_jobs():
                next_run = getattr(job, 'next_run_time', None)
                jobs.append({
                    'id': job.id,
                    'name': job.name,
                    'next_run': next_run.isoformat() if next_run else None,
                })

        return {
            'is_running': self._is_running,
            'last_run': self._last_run.isoformat() if self._last_run else None,
            'last_result': self._last_result,
            'jobs': jobs,
        }


_index_scheduler: Optional[IndexScheduler] = None


def get_index_scheduler() -> IndexScheduler:
    global _index_scheduler
    if _index_scheduler is None:
        _index_scheduler = IndexScheduler()
    return _index_scheduler
