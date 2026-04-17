"""
统一的 LLM Adapter 架构

支持多个 LLM 提供商的统一接口，包括：
- Claude (Anthropic) - 支持 tool calling
- OpenAI - 支持 function calling
- DeepSeek - OpenAI 兼容
- Qwen (DashScope) - 阿里云通义千问
- Doubao (火山引擎 Ark) - 字节跳动豆包

设计理念：
1. 统一的接口，屏蔽各 provider 的差异
2. 支持流式和非流式调用
3. 支持 tool/function calling
4. 自动处理错误和重试
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, AsyncGenerator
from dataclasses import dataclass
from enum import Enum


class LLMProvider(str, Enum):
    """LLM 提供商枚举"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    DEEPSEEK = "deepseek"
    QWEN = "qwen"
    DASHSCOPE = "dashscope"  # Qwen 的别名
    MINIMAX = "minimax"
    GOOGLE = "google"  # Gemini
    DOUBAO = "doubao"


@dataclass
class LLMMessage:
    """统一的消息格式"""
    role: str  # system, user, assistant, tool
    content: str
    name: Optional[str] = None  # 用于 function/tool calling
    tool_calls: Optional[List[Dict[str, Any]]] = None  # OpenAI format
    tool_call_id: Optional[str] = None  # 用于 tool response


@dataclass
class LLMConfig:
    """LLM 配置"""
    temperature: float = 0.7
    max_tokens: int = 2000
    top_p: Optional[float] = None
    stop_sequences: Optional[List[str]] = None
    thinking: bool = False
    thinking_budget: int = 10000
    json_mode: bool = False


@dataclass
class LLMTool:
    """工具定义（统一格式）"""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema


@dataclass
class LLMUsage:
    """Token usage from the last LLM call."""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class BaseLLMAdapter(ABC):
    """
    LLM Adapter 基类

    所有 LLM provider 都需要实现这个接口
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        config: Optional[LLMConfig] = None
    ):
        self.api_key = api_key
        self.model = model
        self.config = config or LLMConfig()
        self.last_usage: Optional[LLMUsage] = None

    @abstractmethod
    async def chat(
        self,
        messages: List[LLMMessage],
        stream: bool = True,
        tools: Optional[List[LLMTool]] = None
    ) -> AsyncGenerator[str, None]:
        """
        聊天接口（流式或非流式）

        Args:
            messages: 消息列表
            stream: 是否流式返回
            tools: 可用工具列表（支持 function/tool calling）

        Yields:
            str: 回复内容（流式）或完整回复（非流式）
        """
        pass

    @abstractmethod
    def convert_messages(self, messages: List[LLMMessage]) -> Any:
        """
        将统一格式的消息转换为 provider 特定格式

        Args:
            messages: 统一格式的消息列表

        Returns:
            Provider 特定格式的消息
        """
        pass

    @abstractmethod
    def convert_tools(self, tools: List[LLMTool]) -> Any:
        """
        将统一格式的工具定义转换为 provider 特定格式

        Args:
            tools: 统一格式的工具列表

        Returns:
            Provider 特定格式的工具定义
        """
        pass

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        tools: Optional[List[LLMTool]] = None
    ) -> AsyncGenerator[str, None]:
        """
        流式聊天接口（简化版，接受字典列表）

        Args:
            messages: 字典格式的消息列表 [{"role": "user", "content": "..."}]
            tools: 可用工具列表

        Yields:
            str: 流式内容块
        """
        # Convert dict messages to LLMMessage objects
        llm_messages = [
            LLMMessage(role=msg.get("role", "user"), content=msg.get("content", ""))
            for msg in messages
        ]
        # Call the main chat method with stream=True
        async for chunk in self.chat(llm_messages, stream=True, tools=tools):
            yield chunk


class OpenAIAdapter(BaseLLMAdapter):
    """OpenAI LLM Adapter — supports custom base_url for proxies (OpenRouter, AIHubMix, etc.)"""

    def __init__(self, api_key: str, model: str, config: Optional[LLMConfig] = None, base_url: Optional[str] = None):
        super().__init__(api_key, model, config)
        from openai import AsyncOpenAI
        kwargs = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = AsyncOpenAI(**kwargs)

    def convert_messages(self, messages: List[LLMMessage]) -> List[Dict[str, Any]]:
        """转换为 OpenAI 消息格式"""
        result = []
        for msg in messages:
            openai_msg = {"role": msg.role, "content": msg.content}
            if msg.name:
                openai_msg["name"] = msg.name
            if msg.tool_calls:
                openai_msg["tool_calls"] = msg.tool_calls
            if msg.tool_call_id:
                openai_msg["tool_call_id"] = msg.tool_call_id
            result.append(openai_msg)
        return result

    def convert_tools(self, tools: List[LLMTool]) -> List[Dict[str, Any]]:
        """转换为 OpenAI function calling 格式"""
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            }
            for tool in tools
        ]

    async def chat(
        self,
        messages: List[LLMMessage],
        stream: bool = True,
        tools: Optional[List[LLMTool]] = None
    ) -> AsyncGenerator[str, None]:
        """OpenAI 聊天接口"""
        openai_messages = self.convert_messages(messages)

        # Reasoning models (o1/o3/o4) use max_completion_tokens, not max_tokens
        is_reasoning = any(self.model.startswith(p) for p in ("o1", "o3", "o4"))
        kwargs = {
            "model": self.model,
            "messages": openai_messages,
            "stream": stream,
        }
        if is_reasoning:
            kwargs["max_completion_tokens"] = self.config.max_tokens
        else:
            kwargs["temperature"] = self.config.temperature
            kwargs["max_tokens"] = self.config.max_tokens

        if self.config.json_mode and not is_reasoning:
            kwargs["response_format"] = {"type": "json_object"}

        if tools:
            kwargs["tools"] = self.convert_tools(tools)

        self.last_usage = None
        response = await self.client.chat.completions.create(**kwargs)

        if stream:
            async for chunk in response:
                if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'content') and delta.content:
                        yield delta.content
                # Capture usage from final stream chunk (OpenAI includes it)
                if hasattr(chunk, 'usage') and chunk.usage:
                    self.last_usage = LLMUsage(
                        input_tokens=chunk.usage.prompt_tokens or 0,
                        output_tokens=chunk.usage.completion_tokens or 0,
                        total_tokens=chunk.usage.total_tokens or 0,
                    )
        else:
            # Capture usage from non-stream response
            if hasattr(response, 'usage') and response.usage:
                self.last_usage = LLMUsage(
                    input_tokens=response.usage.prompt_tokens or 0,
                    output_tokens=response.usage.completion_tokens or 0,
                    total_tokens=response.usage.total_tokens or 0,
                )
            if hasattr(response, 'choices') and len(response.choices) > 0:
                msg = response.choices[0].message
                # o-series reasoning models may include reasoning in response
                reasoning = getattr(msg, 'reasoning_content', None)
                if reasoning:
                    yield f"<thinking>\n{reasoning}\n</thinking>\n\n"
                yield msg.content or ""


class AnthropicAdapter(BaseLLMAdapter):
    """Anthropic (Claude) LLM Adapter"""

    def __init__(self, api_key: str, model: str, config: Optional[LLMConfig] = None):
        super().__init__(api_key, model, config)
        from anthropic import AsyncAnthropic
        self.client = AsyncAnthropic(api_key=api_key)

    def convert_messages(self, messages: List[LLMMessage]) -> tuple:
        """
        转换为 Anthropic 消息格式

        Returns:
            (system_message, anthropic_messages) 元组
        """
        system_message = None
        anthropic_messages = []

        for msg in messages:
            if msg.role == "system":
                system_message = msg.content
            else:
                anthropic_messages.append({
                    "role": msg.role,
                    "content": msg.content
                })

        return system_message, anthropic_messages

    def convert_tools(self, tools: List[LLMTool]) -> List[Dict[str, Any]]:
        """转换为 Anthropic tool calling 格式"""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            }
            for tool in tools
        ]

    async def chat(
        self,
        messages: List[LLMMessage],
        stream: bool = True,
        tools: Optional[List[LLMTool]] = None
    ) -> AsyncGenerator[str, None]:
        """Claude 聊天接口（支持 extended thinking）"""
        system_message, anthropic_messages = self.convert_messages(messages)

        kwargs = {
            "model": self.model,
            "messages": anthropic_messages,
            "max_tokens": self.config.max_tokens,
        }

        if self.config.thinking:
            # Extended thinking: temperature must be 1, use budget_tokens
            kwargs["temperature"] = 1
            kwargs["thinking"] = {
                "type": "enabled",
                "budget_tokens": self.config.thinking_budget,
            }
        else:
            kwargs["temperature"] = self.config.temperature

        if system_message:
            kwargs["system"] = system_message

        if tools:
            kwargs["tools"] = self.convert_tools(tools)

        self.last_usage = None
        if stream:
            async with self.client.messages.stream(**kwargs) as stream_response:
                async for text in stream_response.text_stream:
                    yield text
                # Capture usage from stream final message
                final = stream_response.get_final_message()
                if hasattr(final, 'usage') and final.usage:
                    self.last_usage = LLMUsage(
                        input_tokens=final.usage.input_tokens or 0,
                        output_tokens=final.usage.output_tokens or 0,
                        total_tokens=(final.usage.input_tokens or 0) + (final.usage.output_tokens or 0),
                    )
        else:
            response = await self.client.messages.create(**kwargs)
            # Capture usage
            if hasattr(response, 'usage') and response.usage:
                self.last_usage = LLMUsage(
                    input_tokens=response.usage.input_tokens or 0,
                    output_tokens=response.usage.output_tokens or 0,
                    total_tokens=(response.usage.input_tokens or 0) + (response.usage.output_tokens or 0),
                )
            # Extract thinking + text from response blocks
            thinking_text = ""
            output_text = ""
            for block in response.content:
                if block.type == "thinking":
                    thinking_text += block.thinking
                elif block.type == "text":
                    output_text += block.text
            if thinking_text:
                yield f"<thinking>\n{thinking_text}\n</thinking>\n\n"
            yield output_text


class DeepSeekAdapter(OpenAIAdapter):
    """DeepSeek Adapter (基于 OpenAI 兼容接口)"""

    def __init__(self, api_key: str, model: str, config: Optional[LLMConfig] = None):
        super().__init__(api_key, model, config)
        from openai import AsyncOpenAI
        # DeepSeek 使用自定义 base_url
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )

    async def chat(
        self,
        messages: List[LLMMessage],
        stream: bool = True,
        tools: Optional[List[LLMTool]] = None
    ) -> AsyncGenerator[str, None]:
        """DeepSeek 聊天接口 — deepseek-reasoner 自带 reasoning_content"""
        is_reasoner = "reasoner" in self.model
        if not is_reasoner:
            async for chunk in super().chat(messages, stream, tools):
                yield chunk
            return

        # deepseek-reasoner: no temperature, no streaming, has reasoning_content
        openai_messages = self.convert_messages(messages)
        kwargs = {
            "model": self.model,
            "messages": openai_messages,
            "stream": False,
            "max_completion_tokens": self.config.max_tokens,
        }
        response = await self.client.chat.completions.create(**kwargs)
        if hasattr(response, 'choices') and len(response.choices) > 0:
            msg = response.choices[0].message
            reasoning = getattr(msg, 'reasoning_content', None)
            if reasoning:
                yield f"<thinking>\n{reasoning}\n</thinking>\n\n"
            yield msg.content or ""


class QwenAdapter(OpenAIAdapter):
    """Qwen (DashScope) Adapter — 使用 OpenAI 兼容接口，无需 dashscope SDK"""

    def __init__(self, api_key: str, model: str, config: Optional[LLMConfig] = None):
        super().__init__(api_key, model, config)
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )


# ============================================================================
# MiniMax Adapter (OpenAI兼容)
# ============================================================================


class MiniMaxAdapter(OpenAIAdapter):
    """MiniMax Adapter - 使用OpenAI兼容接口"""

    def __init__(
        self,
        api_key: str,
        model: str = "abab6.5s-chat",
        config: Optional[LLMConfig] = None,
        group_id: Optional[str] = None
    ):
        """初始化 MiniMax Adapter"""
        super().__init__(api_key, model, config)
        self.group_id = group_id
        # MiniMax API base URL
        self.client.base_url = "https://api.minimax.chat/v1"


# ============================================================================
# Google Gemini Adapter
# ============================================================================


class DoubaoAdapter(OpenAIAdapter):
    """Doubao (火山引擎 Ark) Adapter — OpenAI 兼容接口"""

    def __init__(self, api_key: str, model: str, config: Optional[LLMConfig] = None):
        super().__init__(api_key, model, config)
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://ark.cn-beijing.volces.com/api/v3",
        )


class GeminiAdapter(OpenAIAdapter):
    """Google Gemini Adapter — 使用 OpenAI 兼容接口，支持自定义 base_url 代理"""

    # Google 官方 OpenAI 兼容端点
    DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.0-flash",
        config: Optional[LLMConfig] = None,
        base_url: Optional[str] = None,
    ):
        super().__init__(api_key, model, config)
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or self.DEFAULT_BASE_URL,
        )


# ============================================================================
# Adapter Factory
# ============================================================================


class LLMAdapterFactory:
    """LLM Adapter 工厂类"""

    @staticmethod
    def create_unified(
        model: str,
        config: Optional[LLMConfig] = None,
    ) -> BaseLLMAdapter:
        """Sync wrapper kept for legacy callers. Resolves via env only.

        Prefer `create_unified_for_user(user_id, model)` in request-scoped code
        so the user's stored AIHubMix/OpenRouter key is used.
        """
        from uteki.common.config import settings

        api_key = getattr(settings, "aihubmix_api_key", None)
        base_url = getattr(settings, "aihubmix_base_url", None) or "https://aihubmix.com/v1"

        if api_key:
            resolved_model = LLMAdapterFactory._resolve_model_name(model)
            return OpenAIAdapter(api_key, resolved_model, config, base_url=base_url)

        provider, fallback_key, fallback_url = LLMAdapterFactory._infer_provider(model)
        if fallback_key:
            return LLMAdapterFactory.create_adapter(
                provider=provider, api_key=fallback_key,
                model=model, config=config, base_url=fallback_url,
            )

        raise ValueError(
            f"No API key available for model '{model}'. "
            f"Configure AIHubMix/OpenRouter in Settings, or set AIHUBMIX_API_KEY env var."
        )

    @staticmethod
    async def create_unified_for_user(
        user_id: Optional[str],
        model: str,
        config: Optional[LLMConfig] = None,
    ) -> BaseLLMAdapter:
        """Create adapter using the user's stored aggregator key (DB-first, env-fallback).

        Priority:
          1. User's AIHubMix key (DB, encrypted)
          2. User's OpenRouter key (DB, encrypted)
          3. settings.aihubmix_api_key (env var)
          4. provider-specific env keys (legacy fallback)
        """
        from uteki.domains.admin.aggregator_service import resolve_unified_provider

        resolved = await resolve_unified_provider(user_id=user_id)
        if resolved:
            _provider, api_key, base_url = resolved
            # Both AIHubMix and OpenRouter speak the OpenAI protocol on /v1/*
            resolved_model = LLMAdapterFactory._resolve_model_name(model)
            return OpenAIAdapter(api_key, resolved_model, config, base_url=base_url)

        # Final fallback: provider-specific env key
        provider, fallback_key, fallback_url = LLMAdapterFactory._infer_provider(model)
        if fallback_key:
            return LLMAdapterFactory.create_adapter(
                provider=provider, api_key=fallback_key,
                model=model, config=config, base_url=fallback_url,
            )

        raise ValueError(
            f"No LLM key configured for model '{model}'. "
            f"Open Settings → Interface For LLMs and add an AIHubMix or OpenRouter key."
        )

    # Model name mapping: Admin DB / legacy names → AIHubMix-compatible names
    _MODEL_NAME_MAP: dict[str, str] = {
        # Gemini: "thinking" suffix is not a separate model on AIHubMix
        "gemini-2.5-pro-thinking": "gemini-2.5-pro",
        "gemini-2.0-flash-exp": "gemini-2.0-flash",
        # GPT: upgrade legacy model names
        "gpt-4o": "gpt-4.1",
        "gpt-4o-mini": "gpt-4.1-mini",
        "gpt-4-turbo": "gpt-4.1",
        # Qwen: upgrade to latest
        "qwen-plus": "qwen3.5-plus",
        # MiniMax: upgrade to latest
        "MiniMax-Text-01": "MiniMax-M2.7",
    }

    @staticmethod
    def _resolve_model_name(model: str) -> str:
        """Map legacy/direct model names to AIHubMix-compatible names."""
        return LLMAdapterFactory._MODEL_NAME_MAP.get(model, model)

    @staticmethod
    def _infer_provider(model: str) -> tuple:
        """从模型名推断 provider + 获取对应的 API key (fallback 用)."""
        from uteki.common.config import settings

        _MODEL_PROVIDER_RULES = [
            ("claude",    LLMProvider.ANTHROPIC, "anthropic_api_key", None),
            ("gpt-",      LLMProvider.OPENAI,    "openai_api_key",    None),
            ("o1",        LLMProvider.OPENAI,    "openai_api_key",    None),
            ("o3",        LLMProvider.OPENAI,    "openai_api_key",    None),
            ("o4",        LLMProvider.OPENAI,    "openai_api_key",    None),
            ("deepseek",  LLMProvider.DEEPSEEK,  "deepseek_api_key",  None),
            ("qwen",      LLMProvider.QWEN,      "dashscope_api_key", None),
            ("gemini",    LLMProvider.GOOGLE,     "google_api_key",    "google_api_base_url"),
            ("minimax",   LLMProvider.MINIMAX,    "minimax_api_key",   None),
            ("doubao",    LLMProvider.DOUBAO,     "doubao_api_key",    None),
            ("abab",      LLMProvider.MINIMAX,    "minimax_api_key",   None),
        ]

        model_lower = model.lower()
        for prefix, provider, key_attr, url_attr in _MODEL_PROVIDER_RULES:
            if prefix in model_lower:
                api_key = getattr(settings, key_attr, None)
                base_url = getattr(settings, url_attr, None) if url_attr else None
                if api_key:
                    return provider, api_key, base_url

        return LLMProvider.OPENAI, None, None

    @staticmethod
    def create_adapter(
        provider: LLMProvider,
        api_key: str,
        model: str,
        config: Optional[LLMConfig] = None,
        base_url: Optional[str] = None,
    ) -> BaseLLMAdapter:
        """
        直连创建 LLM Adapter (legacy — 新代码请用 create_unified)

        Args:
            provider: LLM 提供商
            api_key: API 密钥
            model: 模型名称
            config: 配置
            base_url: 自定义 API 地址（用于代理）

        Returns:
            相应的 Adapter 实例
        """
        if provider in [LLMProvider.OPENAI]:
            return OpenAIAdapter(api_key, model, config, base_url=base_url)
        elif provider == LLMProvider.ANTHROPIC:
            return AnthropicAdapter(api_key, model, config)
        elif provider == LLMProvider.DEEPSEEK:
            return DeepSeekAdapter(api_key, model, config)
        elif provider in [LLMProvider.QWEN, LLMProvider.DASHSCOPE]:
            return QwenAdapter(api_key, model, config)
        elif provider == LLMProvider.MINIMAX:
            return MiniMaxAdapter(api_key, model, config)
        elif provider == LLMProvider.DOUBAO:
            return DoubaoAdapter(api_key, model, config)
        elif provider == LLMProvider.GOOGLE:
            return GeminiAdapter(api_key, model, config, base_url=base_url)
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")
