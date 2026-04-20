"""新闻 API - Jeff Cox 新闻相关接口"""

import logging
from datetime import date
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query

from uteki.common.cache import get_cache_service
from uteki.domains.auth.deps import get_current_user
from uteki.domains.news.services import (
    get_jeff_cox_service, get_translation_service,
    migrate_local_to_supabase, migrate_supabase_to_local,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_TTL = 86400


def _today() -> str:
    return date.today().isoformat()


@router.get("/jeff-cox/monthly/{year}/{month}")
async def get_monthly_news(
    year: int,
    month: int,
    category: Optional[str] = Query(None, description="分类筛选: all/important/crypto/stocks/forex"),
):
    """
    获取指定月份的 Jeff Cox 新闻

    Returns:
        按日期分组的新闻字典 {"2024-01-15": [...], "2024-01-16": [...]}
    """
    # Treat 'all' as no filter
    if category == 'all':
        category = None

    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_jeff_cox_service()
            news_by_date = await service.get_monthly_news(year, month, category)
            return {
                "success": True,
                "data": news_by_date,
                "date_range": {
                    "start_date": f"{year}-{month:02d}-01",
                    "end_date": f"{year}-{month:02d}-28"
                },
                "category": category
            }
        except Exception as e:
            logger.error(f"获取月度新闻失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    # 空结果只 cache 60s — 否则一个早到的 0 会被钉住一整天。
    return await cache.get_or_set(
        f"uteki:news:jeffcox:monthly:{_today()}:{year}:{month}:{category}",
        _fetch,
        ttl=lambda v: _TTL if v and v.get("data") else 60,
    )


@router.get("/jeff-cox/article/{article_id}")
async def get_article_detail(article_id: str):
    """获取文章详情"""
    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_jeff_cox_service()
            article = await service.get_article_by_id(article_id)
            if not article:
                raise HTTPException(status_code=404, detail="文章不存在")
            return {"success": True, "data": article}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取文章详情失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    return await cache.get_or_set(
        f"uteki:news:jeffcox:article:{_today()}:{article_id}", _fetch, ttl=_TTL,
    )


@router.get("/jeff-cox/latest")
async def get_latest_news(
    limit: int = Query(10, ge=1, le=100),
):
    """获取最新新闻"""
    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_jeff_cox_service()
            articles = await service.get_latest_news(limit)
            return {
                "success": True,
                "data": articles,
                "total_count": len(articles)
            }
        except Exception as e:
            logger.error(f"获取最新新闻失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    return await cache.get_or_set(
        f"uteki:news:jeffcox:latest:{_today()}:{limit}", _fetch, ttl=_TTL,
    )


@router.post("/jeff-cox/scrape")
async def trigger_scrape(
    max_news: int = Query(10, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """
    手动触发新闻抓取

    Returns:
        抓取结果统计
    """
    try:
        service = get_jeff_cox_service()
        result = await service.collect_and_enrich(max_news)
        await get_cache_service().delete_pattern("uteki:news:jeffcox:")
        return result

    except Exception as e:
        logger.error(f"触发抓取失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jeff-cox/translate")
async def translate_pending_articles(
    limit: int = Query(10, ge=1, le=50, description="最多翻译多少篇"),
    provider: str = Query("deepseek", description="翻译提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """
    翻译待翻译的新闻文章

    Returns:
        翻译结果统计
    """
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.translate_pending_articles(limit)
        await get_cache_service().delete_pattern("uteki:news:jeffcox:")

        return {
            "success": True,
            "provider": provider,
            **result
        }

    except Exception as e:
        logger.error(f"翻译失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jeff-cox/article/{article_id}/translate")
async def translate_article(
    article_id: str,
    provider: str = Query("deepseek", description="翻译提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """
    翻译单篇文章

    Returns:
        翻译结果
    """
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.translate_article(article_id)
        await get_cache_service().delete_pattern("uteki:news:jeffcox:")

        return {
            "success": True,
            "provider": provider,
            **result
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"翻译文章失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jeff-cox/label")
async def label_unlabeled_articles(
    limit: int = Query(10, ge=1, le=50, description="最多标签多少篇"),
    provider: str = Query("deepseek", description="LLM 提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """
    为已翻译但未标签的文章生成标签

    Returns:
        标签结果统计
    """
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.label_unlabeled_articles(limit)
        await get_cache_service().delete_pattern("uteki:news:jeffcox:")

        return {
            "success": True,
            "provider": provider,
            **result
        }

    except Exception as e:
        logger.error(f"批量标签失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jeff-cox/article/{article_id}/label")
async def label_article(
    article_id: str,
    provider: str = Query("deepseek", description="LLM 提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """
    为单篇文章生成标签

    Returns:
        标签结果
    """
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.label_article(article_id)
        await get_cache_service().delete_pattern("uteki:news:jeffcox:")

        return {
            "success": True,
            "provider": provider,
            **result
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"标签文章失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/migrate-to-supabase")
async def migrate_to_supabase(user: dict = Depends(get_current_user)):
    """将本地新闻数据迁移到 Supabase"""
    try:
        stats = await migrate_local_to_supabase()
        return {"success": True, **stats}
    except Exception as e:
        logger.error(f"迁移到 Supabase 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-from-supabase")
async def sync_from_supabase(user: dict = Depends(get_current_user)):
    """将 Supabase 新闻数据同步到本地"""
    try:
        stats = await migrate_supabase_to_local()
        return {"success": True, **stats}
    except Exception as e:
        logger.error(f"从 Supabase 同步失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
