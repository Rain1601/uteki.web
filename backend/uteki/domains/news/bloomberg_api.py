"""Bloomberg 新闻 API - 企业债券/固收新闻接口"""

import logging
from datetime import date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Body

from uteki.common.cache import get_cache_service
from uteki.domains.auth.deps import get_current_user
from uteki.domains.news.services import get_bloomberg_service, get_translation_service

logger = logging.getLogger(__name__)
router = APIRouter()

_TTL = 86400


def _today() -> str:
    return date.today().isoformat()


@router.get("/bloomberg/latest")
async def get_latest_news(
    limit: int = Query(10, ge=1, le=100),
):
    """获取最新 Bloomberg 新闻"""
    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_bloomberg_service()
            articles = await service.get_latest_news(limit)
            return {
                "success": True,
                "data": articles,
                "total_count": len(articles),
            }
        except Exception as e:
            logger.error(f"获取 Bloomberg 最新新闻失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    return await cache.get_or_set(
        f"uteki:news:bloomberg:latest:{_today()}:{limit}", _fetch, ttl=_TTL,
    )


@router.get("/bloomberg/monthly/{year}/{month}")
async def get_monthly_news(
    year: int,
    month: int,
    category: Optional[str] = Query(None, description="分类筛选: all/important"),
):
    """获取指定月份的 Bloomberg 新闻（按日期分组）"""
    if category == 'all':
        category = None

    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_bloomberg_service()
            news_by_date = await service.get_monthly_news(year, month, category)
            return {
                "success": True,
                "data": news_by_date,
                "date_range": {
                    "start_date": f"{year}-{month:02d}-01",
                    "end_date": f"{year}-{month:02d}-28",
                },
                "category": category,
            }
        except Exception as e:
            logger.error(f"获取 Bloomberg 月度新闻失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    # 空结果只 cache 60s — 否则早期空响应会钉住一整天。
    return await cache.get_or_set(
        f"uteki:news:bloomberg:monthly:{_today()}:{year}:{month}:{category}",
        _fetch,
        ttl=lambda v: _TTL if v and v.get("data") else 60,
    )


@router.get("/bloomberg/article/{article_id}")
async def get_article_detail(article_id: str):
    """获取 Bloomberg 文章详情"""
    cache = get_cache_service()

    async def _fetch():
        try:
            service = get_bloomberg_service()
            article = await service.get_article_by_id(article_id)
            if not article:
                raise HTTPException(status_code=404, detail="文章不存在")
            return {"success": True, "data": article}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取 Bloomberg 文章详情失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    return await cache.get_or_set(
        f"uteki:news:bloomberg:article:{_today()}:{article_id}", _fetch, ttl=_TTL,
    )


@router.post("/bloomberg/scrape")
async def trigger_scrape(
    max_news: int = Query(10, ge=1, le=50),
    category_urls: Optional[List[str]] = Body(None, description="自定义 Bloomberg 分类页 URL 列表"),
    user: dict = Depends(get_current_user),
):
    """手动触发 Bloomberg 新闻抓取"""
    try:
        service = get_bloomberg_service()
        result = await service.collect_and_enrich(
            max_news=max_news,
            category_urls=category_urls,
        )
        await get_cache_service().delete_pattern("uteki:news:bloomberg:")
        return result

    except Exception as e:
        logger.error(f"触发 Bloomberg 抓取失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bloomberg/translate")
async def translate_pending_articles(
    limit: int = Query(10, ge=1, le=50, description="最多翻译多少篇"),
    provider: str = Query("deepseek", description="翻译提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """翻译待翻译的 Bloomberg 文章"""
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.translate_pending_articles(
            limit, source_filter="bloomberg"
        )
        await get_cache_service().delete_pattern("uteki:news:bloomberg:")

        return {
            "success": True,
            "provider": provider,
            **result,
        }

    except Exception as e:
        logger.error(f"Bloomberg 翻译失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bloomberg/article/{article_id}/translate")
async def translate_article(
    article_id: str,
    provider: str = Query("deepseek", description="翻译提供商: deepseek/qwen"),
    user: dict = Depends(get_current_user),
):
    """翻译单篇 Bloomberg 文章"""
    try:
        translation_service = get_translation_service(provider)
        result = await translation_service.translate_and_label_article(article_id)
        await get_cache_service().delete_pattern("uteki:news:bloomberg:")

        return {
            "success": True,
            "provider": provider,
            **result,
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Bloomberg 翻译文章失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
