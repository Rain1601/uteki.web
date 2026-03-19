"""
uteki.open - FastAPI主应用程序
提供健康检查、数据库状态和基础API端点
"""

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from uteki.common.database import db_manager
from uteki.common.config import settings

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info("Application starting...")
    # Database initialization happens in background to avoid blocking Cloud Run startup
    import asyncio
    asyncio.create_task(initialize_databases())

    # Cleanup expired refresh tokens on startup
    try:
        from uteki.domains.auth.refresh_service import cleanup_expired_tokens
        asyncio.create_task(cleanup_expired_tokens())
        logger.info("Refresh token cleanup scheduled")
    except Exception as e:
        logger.warning(f"Refresh token cleanup failed: {e}")

    # Start news scheduler if enabled
    if settings.environment != "test":
        try:
            from uteki.schedulers import get_news_scheduler
            news_scheduler = get_news_scheduler()
            news_scheduler.start()
            logger.info("News scheduler started")
        except Exception as e:
            logger.warning(f"Failed to start news scheduler: {e}")

    # Start index scheduler (daily price update)
    if settings.environment != "test":
        try:
            from uteki.schedulers import get_index_scheduler
            index_scheduler = get_index_scheduler()
            index_scheduler.start()
            logger.info("Index scheduler started")
        except Exception as e:
            logger.warning(f"Failed to start index scheduler: {e}")

    # Start data scheduler (multi-market K-line ingestion)
    if settings.environment != "test":
        try:
            from uteki.schedulers import get_data_scheduler
            data_scheduler = get_data_scheduler()
            data_scheduler.start()
            logger.info("Data scheduler started")
        except Exception as e:
            logger.warning(f"Failed to start data scheduler: {e}")

    yield

    # Shutdown schedulers
    logger.info("Application shutting down...")
    try:
        from uteki.schedulers import get_news_scheduler
        news_scheduler = get_news_scheduler()
        news_scheduler.stop()
    except Exception:
        pass
    try:
        from uteki.schedulers import get_index_scheduler
        index_scheduler = get_index_scheduler()
        index_scheduler.stop()
    except Exception:
        pass
    try:
        from uteki.schedulers import get_data_scheduler
        data_scheduler = get_data_scheduler()
        data_scheduler.stop()
    except Exception:
        pass


async def initialize_databases():
    """后台初始化数据库连接"""
    global db_init_error
    try:
        await db_manager.initialize()
        logger.info("Database initialization completed")
        db_init_error = None

        # Initialize CacheService after db_manager (uses Redis if available)
        from uteki.common.cache import init_cache_service
        redis_client = db_manager.redis_client if db_manager.redis_available else None
        init_cache_service(redis_client=redis_client)
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        db_init_error = str(e)
        # Don't crash the app, continue with degraded functionality


# Global variable to store initialization error
db_init_error = "Not initialized yet"


# 创建FastAPI应用
app = FastAPI(
    title="uteki.open",
    description="开源量化交易平台 - AI驱动的多资产交易系统",
    version="0.1.0",
    lifespan=lifespan
)

# CORS中间件配置
import os
cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,  # 从环境变量读取，默认Vite端口 + 生产环境前端
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """根路径 - 欢迎信息"""
    return {
        "name": "uteki.open",
        "version": "0.1.0",
        "description": "AI-driven quantitative trading platform",
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/healthz")
async def startup_probe():
    """
    Startup probe - minimal check for Cloud Run
    Returns immediately to satisfy Cloud Run startup requirements
    """
    return {"status": "ok"}


@app.get("/debug/db-init")
async def debug_db_init():
    """
    Debug endpoint to check database initialization status and errors
    """
    return {
        "db_init_error": db_init_error,
        "postgres_available": db_manager.postgres_available,
        "redis_available": db_manager.redis_available
    }


@app.get("/health")
async def health_check():
    """
    健康检查端点
    返回所有数据库的连接状态
    """
    return {
        "status": "healthy",
        "databases": {
            "postgres": {
                "available": db_manager.postgres_available,
                "status": "✓ connected" if db_manager.postgres_available else "✗ disconnected"
            },
            "redis": {
                "available": db_manager.redis_available,
                "status": "✓ connected" if db_manager.redis_available else "✗ disconnected"
            },
            "clickhouse": {
                "available": db_manager.clickhouse_available,
                "status": "✓ connected" if db_manager.clickhouse_available else "⚠ using PostgreSQL fallback"
            },
            "qdrant": {
                "available": db_manager.qdrant_available,
                "status": "✓ connected" if db_manager.qdrant_available else "⚠ agent memory disabled"
            },
            "minio": {
                "available": db_manager.minio_available,
                "status": "✓ connected" if db_manager.minio_available else "⚠ file storage disabled"
            }
        },
        "degradation": {
            "use_postgres_for_analytics": db_manager.use_postgres_for_analytics,
            "disable_agent_memory": db_manager.disable_agent_memory,
            "disable_file_storage": db_manager.disable_file_storage
        }
    }


@app.get("/api/status")
async def api_status():
    """
    API状态端点
    返回系统整体状态和可用功能
    """
    critical_dbs_ok = db_manager.postgres_available and db_manager.redis_available

    features = {
        "admin": critical_dbs_ok,
        "trading": critical_dbs_ok,
        "agent": critical_dbs_ok,
        "dashboard": critical_dbs_ok,
        "analytics": db_manager.clickhouse_available or db_manager.use_postgres_for_analytics,
        "agent_memory": db_manager.qdrant_available,
        "file_storage": db_manager.minio_available
    }

    return {
        "system_status": "operational" if critical_dbs_ok else "degraded",
        "available_features": features,
        "warnings": [
            msg for msg in [
                "ClickHouse unavailable - using PostgreSQL fallback" if db_manager.use_postgres_for_analytics else None,
                "Qdrant unavailable - agent memory disabled" if db_manager.disable_agent_memory else None,
                "MinIO unavailable - file storage disabled" if db_manager.disable_file_storage else None
            ] if msg
        ]
    }


# 导入domain路由
from uteki.domains.admin.api import router as admin_router
from uteki.domains.agent.api import router as agent_router
from uteki.domains.auth.api import router as auth_router
from uteki.domains.news.api import router as news_router
from uteki.domains.news.analysis_api import router as news_analysis_router
from uteki.domains.news.bloomberg_api import router as bloomberg_news_router
from uteki.domains.macro.api import router as macro_router
from uteki.domains.macro.fred_api import router as fred_router
from uteki.domains.macro.dashboard_api import router as dashboard_router
from uteki.domains.macro.marketcap_api import router as marketcap_router
from uteki.domains.snb.api import router as snb_router
from uteki.domains.index.api import router as index_router
from uteki.domains.data.api import router as data_router
from uteki.domains.data.udf_api import router as udf_router
from uteki.domains.company.api import router as company_router
# from uteki.domains.trading.api import router as trading_router  # 待实现
# from uteki.domains.evaluation.api import router as evaluation_router  # 待实现
# from uteki.domains.dashboard.api import router as dashboard_router  # 待实现

# 注册domain路由
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(agent_router, prefix="/api/agent", tags=["agent"])
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(news_router, prefix="/api/news", tags=["news"])
app.include_router(news_analysis_router, prefix="/api/news-analysis", tags=["news-analysis"])
app.include_router(bloomberg_news_router, prefix="/api/news", tags=["bloomberg-news"])
app.include_router(macro_router, prefix="/api/economic-calendar", tags=["economic-calendar"])
app.include_router(fred_router, prefix="/api/macro/fred", tags=["fred"])
app.include_router(dashboard_router, prefix="/api/macro/dashboard", tags=["market-dashboard"])
app.include_router(marketcap_router, prefix="/api/macro/marketcap", tags=["marketcap"])
app.include_router(snb_router, prefix="/api/snb", tags=["snb"])
app.include_router(index_router, prefix="/api/index", tags=["index"])
app.include_router(data_router, prefix="/api/data", tags=["market-data"])
app.include_router(udf_router, prefix="/api/udf", tags=["udf-datafeed"])
app.include_router(company_router, prefix="/api/company", tags=["company"])
# app.include_router(trading_router, prefix="/api/trading", tags=["trading"])  # 待实现
# app.include_router(evaluation_router, prefix="/api/evaluation", tags=["evaluation"])  # 待实现
# app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])  # 待实现


if __name__ == "__main__":
    import uvicorn
    import os

    # 从环境变量读取端口，默认8888
    port = int(os.getenv("API_PORT", "8888"))

    uvicorn.run(
        "uteki.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
