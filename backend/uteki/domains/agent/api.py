"""
Agent domain API routes - FastAPI路由
"""

from datetime import date
from fastapi import APIRouter, HTTPException, status, Query
from fastapi.responses import StreamingResponse, Response
from typing import List, Optional
from pydantic import BaseModel
import json
import logging
import uuid
import base64
import httpx

from uteki.common.cache import get_cache_service
from uteki.domains.agent import schemas
from uteki.domains.agent.service import ChatService, get_chat_service
from uteki.domains.agent.research import ResearchRequest, DeepResearchOrchestrator
from uteki.domains.agent.research.search_engine import SearchEngine
from uteki.domains.agent.llm_adapter import LLMAdapterFactory
from uteki.common.config import settings
from uteki.domains.auth.deps import get_current_user_optional
from fastapi import Depends

router = APIRouter()
logger = logging.getLogger(__name__)

_TTL = 86400
_SHORT_TTL = 300


def _today() -> str:
    return date.today().isoformat()


# Module-level service instance (no DB session needed)
chat_svc = get_chat_service()


# ============================================================================
# Intent Router — LLM-based classification for research vs chat
# ============================================================================


class IntentRouteRequest(BaseModel):
    message: str
    conversation_context: Optional[list] = None  # recent messages for context


class IntentRouteResponse(BaseModel):
    route: str  # "research" or "chat"
    reason: str


_ROUTER_PROMPT = """You are an intent classifier. Given a user message and optional conversation context, decide whether the message needs web research or can be answered directly.

Output ONLY a JSON object: {"route": "research" or "chat", "reason": "brief reason"}

Rules:
- "research": questions needing current/factual information from the web (stock prices, recent events, company analysis, market data, comparisons requiring up-to-date info, "what happened", "latest news", etc.)
- "chat": greetings, follow-up questions in an ongoing conversation, creative tasks (writing, coding), opinion questions, explanations of concepts, translations, simple factual questions the model already knows, meta questions about the AI itself

Examples:
- "你好" → {"route": "chat", "reason": "greeting"}
- "帮我写一个排序算法" → {"route": "chat", "reason": "coding task"}
- "那具体怎么实现？" → {"route": "chat", "reason": "follow-up"}
- "阿里巴巴最近的股价怎么样" → {"route": "research", "reason": "current stock data needed"}
- "比较特斯拉和比亚迪的市场份额" → {"route": "research", "reason": "current market data comparison"}
- "2024年美联储加息了几次" → {"route": "research", "reason": "specific factual data needed"}
- "什么是量化宽松" → {"route": "chat", "reason": "concept explanation"}"""


@router.post("/route", response_model=IntentRouteResponse)
async def route_intent(
    req: IntentRouteRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Classify user intent: research vs chat. Uses a fast/cheap model."""
    from uteki.domains.agent.llm_adapter import LLMConfig, LLMMessage
    from uteki.domains.admin.aggregator_service import resolve_unified_provider

    # Build context
    user_content = req.message
    if req.conversation_context:
        recent = req.conversation_context[-4:]  # last 2 turns
        ctx_lines = []
        for m in recent:
            role = m.get("role", "user")
            content = m.get("content", "")[:200]
            ctx_lines.append(f"{role}: {content}")
        user_content = "Conversation context:\n" + "\n".join(ctx_lines) + f"\n\nNew message: {req.message}"

    try:
        from openai import AsyncOpenAI

        user_id = current_user.get("user_id") if current_user else None
        resolved = await resolve_unified_provider(user_id=user_id)
        if not resolved:
            return IntentRouteResponse(route="chat", reason="no aggregator key configured")
        _agg, aihub_key, aihub_url = resolved

        client = AsyncOpenAI(api_key=aihub_key, base_url=aihub_url)
        resp = await client.chat.completions.create(
            model="gpt-4.1-nano",  # fastest + cheapest
            messages=[
                {"role": "system", "content": _ROUTER_PROMPT},
                {"role": "user", "content": user_content},
            ],
            max_tokens=80,
            temperature=0,
        )

        result = resp.choices[0].message.content or ""
        import re
        json_match = re.search(r'\{[^}]+\}', result)
        if json_match:
            data = json.loads(json_match.group(0))
            return IntentRouteResponse(
                route=data.get("route", "chat"),
                reason=data.get("reason", ""),
            )
    except Exception as e:
        logger.warning(f"[route] intent classification failed: {e}")

    # Fallback: chat (safer default)
    return IntentRouteResponse(route="chat", reason="fallback")


# ============================================================================
# Conversation Routes
# ============================================================================


@router.post(
    "/conversations",
    response_model=schemas.ChatConversationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建聊天会话",
)
async def create_conversation(
    data: schemas.ChatConversationCreate,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    创建新的聊天会话

    - **title**: 会话标题
    - **mode**: 会话模式 (chat, analysis, trading)
    """
    data.user_id = current_user["user_id"] if current_user else "default"
    conversation = await chat_svc.create_conversation(data)
    await get_cache_service().delete_pattern(f"uteki:agent:conversations:{data.user_id}:")

    return schemas.ChatConversationResponse(
        id=conversation["id"],
        title=conversation["title"],
        mode=conversation["mode"],
        user_id=conversation.get("user_id"),
        is_archived=conversation.get("is_archived", False),
        created_at=conversation["created_at"],
        updated_at=conversation["updated_at"],
    )


@router.get(
    "/conversations",
    response_model=schemas.PaginatedConversationsResponse,
    summary="列出聊天会话",
)
async def list_conversations(
    include_archived: bool = Query(False, description="是否包含归档会话"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """列出当前用户的聊天会话"""
    user_id = current_user["user_id"] if current_user else "default"
    cache = get_cache_service()

    async def _fetch():
        items, total = await chat_svc.list_conversations(
            user_id=user_id, skip=skip, limit=limit, include_archived=include_archived
        )

        # 转换为响应schema
        response_items = [
            schemas.ChatConversationResponse(
                id=item["id"],
                title=item["title"],
                mode=item["mode"],
                user_id=item.get("user_id"),
                is_archived=item.get("is_archived", False),
                created_at=item["created_at"],
                updated_at=item["updated_at"],
            )
            for item in items
        ]

        from fastapi.encoders import jsonable_encoder
        return jsonable_encoder(schemas.PaginatedConversationsResponse(
            items=response_items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:agent:conversations:{user_id}:list:{_today()}:{skip}:{limit}:{include_archived}",
        _fetch, ttl=_SHORT_TTL,
    )


@router.get(
    "/conversations/{conversation_id}",
    response_model=schemas.ChatConversationDetailResponse,
    summary="获取聊天会话详情",
)
async def get_conversation(conversation_id: str):
    """获取指定聊天会话的详细信息（包含消息历史）"""
    cache = get_cache_service()

    async def _fetch():
        conversation = await chat_svc.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # 获取消息历史
        messages = await chat_svc.get_conversation_messages(conversation_id)

        from fastapi.encoders import jsonable_encoder
        return jsonable_encoder(schemas.ChatConversationDetailResponse(
            id=conversation["id"],
            title=conversation["title"],
            mode=conversation["mode"],
            user_id=conversation.get("user_id"),
            is_archived=conversation.get("is_archived", False),
            created_at=conversation["created_at"],
            updated_at=conversation["updated_at"],
            messages=[
                schemas.ChatMessageResponse(
                    id=msg["id"],
                    conversation_id=msg["conversation_id"],
                    role=msg["role"],
                    content=msg["content"],
                    llm_provider=msg.get("llm_provider"),
                    llm_model=msg.get("llm_model"),
                    token_usage=msg.get("token_usage"),
                    created_at=msg["created_at"],
                    updated_at=msg["updated_at"],
                )
                for msg in messages
            ],
        ))

    return await cache.get_or_set(
        f"uteki:agent:conversations:get:{_today()}:{conversation_id}", _fetch, ttl=_SHORT_TTL,
    )


@router.patch(
    "/conversations/{conversation_id}",
    response_model=schemas.ChatConversationResponse,
    summary="更新聊天会话",
)
async def update_conversation(
    conversation_id: str,
    data: schemas.ChatConversationUpdate,
):
    """更新聊天会话（标题、归档状态等）"""
    conversation = await chat_svc.update_conversation(conversation_id, data)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await get_cache_service().delete_pattern("uteki:agent:conversations:")

    return schemas.ChatConversationResponse(
        id=conversation["id"],
        title=conversation["title"],
        mode=conversation["mode"],
        user_id=conversation.get("user_id"),
        is_archived=conversation.get("is_archived", False),
        created_at=conversation["created_at"],
        updated_at=conversation["updated_at"],
    )


@router.delete(
    "/conversations/{conversation_id}",
    response_model=schemas.MessageResponse,
    summary="删除聊天会话",
)
async def delete_conversation(conversation_id: str):
    """删除聊天会话（会级联删除所有消息）"""
    success = await chat_svc.delete_conversation(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await get_cache_service().delete_pattern("uteki:agent:conversations:")

    return schemas.MessageResponse(message="Conversation deleted successfully")


# ============================================================================
# Chat Routes
# ============================================================================


@router.post(
    "/chat",
    summary="聊天接口（流式返回）",
)
async def chat(data: schemas.ChatRequest):
    """
    与Agent进行聊天（支持流式返回）

    - **conversation_id**: 会话ID（新会话时为null）
    - **message**: 用户消息
    - **mode**: 聊天模式 (chat, analysis, trading)
    - **stream**: 是否流式返回（默认true）
    - **llm_provider_id**: 指定LLM提供商ID（可选，不指定则使用默认）

    返回格式：Server-Sent Events (text/event-stream)
    每个事件格式：
    ```
    data: {"conversation_id": "xxx", "chunk": "...", "done": false}
    ```
    """

    async def event_generator():
        """SSE事件生成器"""
        try:
            async for chunk in chat_svc.chat(data):
                # 转换为JSON并发送
                yield f"data: {chunk.model_dump_json()}\n\n"
        except Exception as e:
            # 发送错误信息
            error_data = {
                "error": str(e),
                "conversation_id": data.conversation_id or "",
                "done": True
            }
            yield f"data: {json.dumps(error_data)}\n\n"

    # Invalidate conversation caches after chat
    await get_cache_service().delete_pattern("uteki:agent:conversations:")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用nginx缓冲
        },
    )


@router.post(
    "/chat/sync",
    response_model=schemas.ChatResponse,
    summary="聊天接口（非流式）",
)
async def chat_sync(data: schemas.ChatRequest):
    """
    与Agent进行聊天（非流式返回，等待完整响应）

    适用于不需要流式输出的场景
    """
    # 修改为非流式
    data.stream = False

    # 收集完整响应
    conversation_id = None
    full_content = ""

    async for chunk in chat_svc.chat(data):
        conversation_id = chunk.conversation_id
        if not chunk.done:
            full_content += chunk.chunk

    if not conversation_id:
        raise HTTPException(
            status_code=500, detail="Failed to generate response"
        )

    await get_cache_service().delete_pattern("uteki:agent:conversations:")

    # 返回完整响应
    return schemas.ChatResponse(
        conversation_id=conversation_id,
        message_id="",  # 可以从数据库获取最新消息ID
        role="assistant",
        content=full_content,
    )


# ============================================================================
# Model Configuration Routes
# ============================================================================


@router.get(
    "/models/available",
    summary="获取可用的模型列表",
)
async def get_available_models():
    """
    返回所有支持的模型列表（从 DB model_config 读取）
    """
    cache = get_cache_service()

    async def _fetch():
        from uteki.domains.index.services.arena_service import load_models_from_db

        PROVIDER_ICONS = {
            "anthropic": "/icons/models/claude.png",
            "openai": "/icons/models/openai.png",
            "deepseek": "/icons/models/deepseek.png",
            "google": "/icons/models/gemini.png",
            "qwen": "/icons/models/qwen.png",
            "minimax": "/icons/models/minimax.png",
            "doubao": "/icons/models/doubao.png",
        }
        PROVIDER_DISPLAY = {
            "anthropic": "Claude", "openai": "OpenAI", "deepseek": "DeepSeek",
            "google": "Google", "qwen": "Qwen", "minimax": "MiniMax", "doubao": "豆包",
        }

        db_models = load_models_from_db()
        if not db_models:
            return {
                "models": [],
                "default_model": None,
                "hint": "尚未配置任何 LLM 模型。请前往「Settings → Model Config」页面添加至少一个模型的 API Key。",
            }

        all_models = []
        for m in db_models:
            all_models.append({
                "id": m["model"],
                "name": m["model"],
                "provider": PROVIDER_DISPLAY.get(m["provider"], m["provider"]),
                "icon": PROVIDER_ICONS.get(m["provider"], ""),
                "available": True,
            })

        return {
            "models": all_models,
            "default_model": db_models[0]["model"] if db_models else None,
        }

    return await cache.get_or_set(
        f"uteki:agent:models_available:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


# ============================================================================
# Deep Research Routes
# ============================================================================


@router.post(
    "/research/stream",
    summary="Deep Research - 流式返回",
)
async def research_stream(request: ResearchRequest):
    """
    执行深度研究（Deep Research）并流式返回进度

    - **query**: 研究问题
    - **max_sources**: 最大搜索结果数（默认20）
    - **max_scrape**: 最大抓取URL数（默认10）

    返回格式：Server-Sent Events (text/event-stream)

    事件类型：
    - research_start: 研究开始
    - thought: 子任务分解
    - status: 状态更新
    - plan_created: 研究计划创建
    - sources_update: 搜索进度更新
    - sources_complete: 搜索完成
    - source_read: 内容抓取进度
    - content_chunk: LLM响应流式输出
    - research_complete: 研究完成
    - error: 错误信息
    """
    from uteki.domains.index.services.arena_service import load_models_from_db

    search_engine = SearchEngine(
        google_api_key=settings.google_search_api_key,
        google_engine_id=settings.google_search_engine_id,
    )
    orchestrator = DeepResearchOrchestrator(search_engine=search_engine)

    async def event_generator():
        """SSE事件生成器"""
        try:
            # Create LLM adapter from DB config
            db_models = load_models_from_db()
            llm_adapter = None
            for m in db_models:
                try:
                    llm_adapter = LLMAdapterFactory.create_unified(model=m["model"])
                    break
                except Exception:
                    continue

            if not llm_adapter:
                raise ValueError(
                    "尚未配置任何 LLM 模型。请前往「Settings → Model Config」页面添加至少一个模型的 API Key。"
                )

            async for event in orchestrator.research_stream(
                query=request.query,
                max_sources=request.max_sources,
                max_scrape=request.max_scrape,
                llm_adapter=llm_adapter,
            ):
                event_data = json.dumps(event, ensure_ascii=False)
                yield f"data: {event_data}\n\n"

        except Exception as e:
            logger.error(f"Research stream error: {e}", exc_info=True)
            error_event = {"type": "error", "data": {"message": str(e)}}
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/research/health",
    summary="Deep Research 健康检查",
)
async def research_health():
    """
    检查Deep Research功能的健康状态

    返回：
    - search_engine: 配置的搜索引擎
    - google_configured: Google API是否已配置
    - dependencies: 依赖包状态
    """
    from uteki.common.config import settings

    # Check Google Custom Search configuration
    google_configured = bool(
        settings.google_search_api_key and settings.google_search_engine_id
    )

    # Default to Google if configured, otherwise DuckDuckGo
    search_engine = "google" if google_configured else "duckduckgo"

    # Check dependencies
    dependencies = {}
    try:
        import ddgs  # New package name
        dependencies["ddgs"] = True
    except ImportError:
        dependencies["ddgs"] = False

    try:
        import bs4  # beautifulsoup4
        dependencies["beautifulsoup4"] = True
    except ImportError:
        dependencies["beautifulsoup4"] = False

    try:
        import trafilatura
        dependencies["trafilatura"] = True
    except ImportError:
        dependencies["trafilatura"] = False

    return {
        "status": "healthy",
        "search_engine": search_engine,
        "google_configured": google_configured,
        "google_api_key_present": bool(settings.google_search_api_key),
        "google_engine_id_present": bool(settings.google_search_engine_id),
        "dependencies": dependencies,
    }


# ============================================================================
# TTS Routes (火山引擎语音合成)
# ============================================================================


class TTSRequest(BaseModel):
    text: str
    voice_type: Optional[str] = None


@router.post(
    "/tts",
    summary="文字转语音（火山引擎 TTS）",
)
async def text_to_speech(data: TTSRequest):
    """
    将文字转换为语音，返回 mp3 音频流。
    使用火山引擎 openspeech TTS HTTP API。
    """
    if not settings.volc_tts_app_id or not settings.volc_tts_access_token:
        raise HTTPException(
            status_code=500,
            detail="TTS 未配置：请设置 VOLC_TTS_APP_ID 和 VOLC_TTS_ACCESS_TOKEN",
        )

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")

    voice_type = data.voice_type or settings.volc_tts_voice_type

    payload = {
        "app": {
            "appid": settings.volc_tts_app_id,
            "token": settings.volc_tts_access_token,
            "cluster": settings.volc_tts_cluster,
        },
        "user": {
            "uid": "uteki_user",
        },
        "audio": {
            "voice_type": voice_type,
            "encoding": "mp3",
            "speed_ratio": 1.0,
            "volume_ratio": 1.0,
            "pitch_ratio": 1.0,
        },
        "request": {
            "reqid": str(uuid.uuid4()),
            "text": data.text,
            "text_type": "plain",
            "operation": "query",
        },
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer;{settings.volc_tts_access_token}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://openspeech.bytedance.com/api/v1/tts",
                json=payload,
                headers=headers,
            )

        if resp.status_code != 200:
            logger.error(f"TTS API error: status={resp.status_code}, body={resp.text[:500]}")
            raise HTTPException(status_code=502, detail="TTS 服务请求失败")

        result = resp.json()

        if "data" not in result:
            logger.error(f"TTS API unexpected response: {json.dumps(result)[:500]}")
            raise HTTPException(status_code=502, detail="TTS 服务返回格式异常")

        audio_bytes = base64.b64decode(result["data"])
        return Response(content=audio_bytes, media_type="audio/mpeg")

    except httpx.RequestError as e:
        logger.error(f"TTS request error: {e}")
        raise HTTPException(status_code=502, detail="TTS 服务连接失败")
