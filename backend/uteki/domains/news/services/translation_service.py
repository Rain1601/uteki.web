"""新闻翻译服务 - 使用 DeepSeek/Qwen 将英文新闻翻译为中文，同时进行自动标签"""

import json
import logging
import re
from typing import Optional, Dict, Any, List
from datetime import datetime

from uteki.domains.agent.llm_adapter import LLMAdapterFactory, LLMConfig
from uteki.domains.news.services.sync_service import get_news_repo, backup_to_sqlite

logger = logging.getLogger(__name__)

# 有效的标签值
VALID_IMPORTANCE_LEVELS = {'critical', 'high', 'medium', 'low'}
VALID_IMPACT_VALUES = {'bullish', 'bearish', 'neutral'}
VALID_CONFIDENCE_LEVELS = {'high', 'medium', 'low'}

TRANSLATION_AND_LABELING_SYSTEM_PROMPT = """你是一个专业的金融新闻分析师和翻译专家。

你的任务是：
1. 将英文新闻翻译成中文
2. 分析新闻的重要性、市场影响方向和置信度

翻译要求：
- 保持原文的语气和风格
- 专业术语要准确（如：Federal Reserve 翻译为 美联储，FOMC 翻译为 联邦公开市场委员会）
- 数字、日期、人名等保持原样或按中文习惯格式化

标签说明：
- importance_level（重要性）:
  - critical: 美联储利率决议、重大政策变化、市场重大波动
  - high: 重要经济数据（就业、通胀）、央行官员讲话
  - medium: 市场评论、分析师观点、行业新闻
  - low: 日常市场更新、小型经济指标

- ai_impact（市场影响方向）:
  - bullish: 利好市场，增长信号，鸽派政策
  - bearish: 利空市场，衰退信号，鹰派政策
  - neutral: 影响不明确或混合信号

- impact_confidence（置信度）:
  - high: 新闻内容清晰，影响明确
  - medium: 有一定不确定性
  - low: 推测性内容，信号混杂

你必须以 JSON 格式返回结果，不要包含任何其他文字。"""

TRANSLATION_ONLY_SYSTEM_PROMPT = """你是一个专业的英文到中文翻译专家，专注于金融新闻和经济内容的翻译。
请保持翻译的准确性、流畅性和专业性。
翻译时需要注意：
1. 保持原文的语气和风格
2. 专业术语要准确（如：Federal Reserve 翻译为 美联储）
3. 数字、日期、人名等保持原样或按中文习惯格式化
4. 仅返回翻译结果，不要添加任何解释或说明"""


class TranslationService:
    """新闻翻译与自动标签服务"""

    def __init__(self, provider: str = "deepseek"):
        self.provider = provider.lower()
        self._llm_adapter = None
        self._db_model = None

        # 从 DB model_config 读取配置
        from uteki.domains.index.services.arena_service import load_models_from_db
        db_models = load_models_from_db()

        # 优先匹配指定 provider
        self._db_model = next((m for m in db_models if m["provider"] == self.provider), None)
        # 未匹配到则用第一个可用模型
        if not self._db_model and db_models:
            self._db_model = db_models[0]
            self.provider = self._db_model["provider"]

        if self._db_model:
            self.model = self._db_model["model"]
            logger.info(f"翻译服务初始化: provider={self.provider}, model={self.model}")
        else:
            self.model = None
            logger.warning("翻译服务初始化: 未找到任何 LLM 配置")

    async def _get_llm_adapter(self):
        """获取 LLM adapter — 通过 aggregator resolver 拿 key (DB 优先, env 兜底)。

        scheduler 触发时无 user_id, create_unified_for_user(user_id=None) 会走
        resolve_unified_provider 的 DB 扫描兜底，使用用户在 UI 里保存的最新 key。
        """
        if self._llm_adapter is None:
            if not self._db_model:
                raise ValueError(
                    "尚未配置任何 LLM 模型。请前往「Settings → Model Config」页面添加至少一个模型的 API Key。"
                )

            config = LLMConfig(temperature=0.3, max_tokens=4096)
            self._llm_adapter = await LLMAdapterFactory.create_unified_for_user(
                user_id=None,
                model=self.model,
                config=config,
            )
        return self._llm_adapter

    def _validate_label(self, value: Optional[str], valid_values: set) -> Optional[str]:
        """验证标签值，无效则返回 None"""
        if value is None:
            return None
        value_lower = value.lower().strip()
        if value_lower in valid_values:
            return value_lower
        logger.warning(f"无效的标签值: {value}, 有效值: {valid_values}")
        return None

    def _extract_json_from_response(self, response: str) -> Optional[Dict]:
        """从 LLM 响应中提取 JSON"""
        # 尝试直接解析
        try:
            return json.loads(response.strip())
        except json.JSONDecodeError:
            pass

        # 尝试从 markdown code block 中提取
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试找到 JSON 对象
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    async def translate_text(self, text: str, context: str = "news article") -> str:
        """翻译单个文本（仅翻译，无标签）"""
        if not text or not text.strip():
            return ""

        try:
            adapter = await self._get_llm_adapter()

            messages = [
                {"role": "system", "content": TRANSLATION_ONLY_SYSTEM_PROMPT},
                {"role": "user", "content": f"请将以下{context}翻译为中文：\n\n{text}"},
            ]

            result = ""
            async for chunk in adapter.chat_stream(messages):
                result += chunk

            logger.info(f"翻译成功: {len(text)} -> {len(result)} 字符")
            return result.strip()

        except Exception as e:
            logger.error(f"翻译失败: {e}")
            raise

    async def translate_and_label_article(
        self, article_id: str
    ) -> Dict[str, Any]:
        """翻译文章并生成标签（合并为一次 LLM 调用）"""
        try:
            repo = get_news_repo()
            article = repo.select_one(eq={"id": article_id})

            if not article:
                raise ValueError(f"文章不存在: {article_id}")

            # 检查是否已翻译
            if article.get("translation_status") == 'completed':
                logger.info(f"文章已翻译: {article_id}")
                return {
                    "status": "already_translated",
                    "article_id": article_id,
                }

            logger.info(f"开始翻译并标签文章: {article_id}")

            # 构建要翻译的内容
            title = article.get("title") or ""
            keypoints = article.get("summary_keypoints") or ""
            content = (article.get("content_full") or "")[:5000]  # 限制长度

            # 构建 JSON 请求
            user_prompt = f"""请分析并翻译以下新闻：

标题: {title}
关键要点: {keypoints}
正文: {content}

请返回 JSON 格式（只返回 JSON，不要其他文字）：
{{
  "title_zh": "翻译后的标题",
  "keypoints_zh": "翻译后的关键要点",
  "content_zh": "翻译后的正文",
  "importance_level": "critical/high/medium/low",
  "ai_impact": "bullish/bearish/neutral",
  "impact_confidence": "high/medium/low"
}}"""

            adapter = await self._get_llm_adapter()
            messages = [
                {"role": "system", "content": TRANSLATION_AND_LABELING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]

            response = ""
            async for chunk in adapter.chat_stream(messages):
                response += chunk

            # 解析 JSON 响应
            parsed = self._extract_json_from_response(response)
            results = {"translated": False, "labeled": False}

            # 准备更新数据
            update_data = {}

            if parsed:
                # 提取翻译
                if parsed.get("title_zh") and not article.get("title_zh"):
                    update_data["title_zh"] = parsed["title_zh"]
                    results["translated"] = True

                if parsed.get("keypoints_zh") and not article.get("summary_keypoints_zh"):
                    update_data["summary_keypoints_zh"] = parsed["keypoints_zh"]

                if parsed.get("content_zh") and not article.get("content_full_zh"):
                    update_data["content_full_zh"] = parsed["content_zh"]

                # 提取并验证标签
                importance = self._validate_label(
                    parsed.get("importance_level"), VALID_IMPORTANCE_LEVELS
                )
                impact = self._validate_label(
                    parsed.get("ai_impact"), VALID_IMPACT_VALUES
                )
                confidence = self._validate_label(
                    parsed.get("impact_confidence"), VALID_CONFIDENCE_LEVELS
                )

                if importance:
                    update_data["importance_level"] = importance
                    results["labeled"] = True
                if impact:
                    update_data["ai_impact"] = impact
                if confidence:
                    update_data["impact_confidence"] = confidence

                logger.info(f"标签结果: importance={importance}, impact={impact}, confidence={confidence}")

            else:
                # JSON 解析失败，回退到纯翻译模式
                logger.warning(f"JSON 解析失败，回退到纯翻译模式: {article_id}")
                if title and not article.get("title_zh"):
                    update_data["title_zh"] = await self.translate_text(title, "标题")
                    results["translated"] = True
                if keypoints and not article.get("summary_keypoints_zh"):
                    update_data["summary_keypoints_zh"] = await self.translate_text(keypoints, "关键要点")
                if content and not article.get("content_full_zh"):
                    update_data["content_full_zh"] = await self.translate_text(content, "正文")

            # 更新状态
            update_data["translation_status"] = "completed"
            update_data["translated_at"] = datetime.utcnow().isoformat()
            update_data["translation_model"] = f"{self.provider}:{self.model}"

            repo.update(data=update_data, eq={"id": article_id})

            # 备份到 SQLite
            updated_article = repo.select_one(eq={"id": article_id})
            if updated_article:
                await backup_to_sqlite([updated_article])

            # 自动 AI 分析（翻译后自动触发，失败不阻断）
            try:
                from uteki.domains.news.services.news_analysis_service import get_news_analysis_service
                analysis_service = get_news_analysis_service()
                await analysis_service.analyze_article(article_id)
            except Exception as analysis_err:
                logger.warning(f"自动 AI 分析跳过: {article_id} - {analysis_err}")

            logger.info(f"文章翻译标签完成: {article_id}")

            return {
                "status": "success",
                "article_id": article_id,
                "translated": results["translated"],
                "labeled": results["labeled"],
                "importance_level": update_data.get("importance_level"),
                "ai_impact": update_data.get("ai_impact"),
                "impact_confidence": update_data.get("impact_confidence"),
            }

        except Exception as e:
            logger.error(f"翻译标签文章失败: {article_id}, 错误: {e}")
            raise

    async def translate_article(
        self, article_id: str
    ) -> Dict[str, Any]:
        """翻译文章（向后兼容，调用 translate_and_label_article）"""
        return await self.translate_and_label_article(article_id)

    async def label_article(
        self, article_id: str
    ) -> Dict[str, Any]:
        """仅对文章生成标签（不翻译）"""
        try:
            repo = get_news_repo()
            article = repo.select_one(eq={"id": article_id})

            if not article:
                raise ValueError(f"文章不存在: {article_id}")

            # 已有标签则跳过
            if article.get("importance_level") and article.get("impact_confidence"):
                return {
                    "status": "already_labeled",
                    "article_id": article_id,
                }

            logger.info(f"开始标签文章: {article_id}")

            # 使用中文内容（如有）或英文内容
            title = article.get("title_zh") or article.get("title") or ""
            content = (article.get("content_full_zh") or article.get("content_full") or "")[:3000]

            user_prompt = f"""请分析以下新闻的重要性和市场影响：

标题: {title}
正文: {content}

请返回 JSON 格式（只返回 JSON，不要其他文字）：
{{
  "importance_level": "critical/high/medium/low",
  "ai_impact": "bullish/bearish/neutral",
  "impact_confidence": "high/medium/low"
}}"""

            adapter = await self._get_llm_adapter()
            messages = [
                {"role": "system", "content": TRANSLATION_AND_LABELING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]

            response = ""
            async for chunk in adapter.chat_stream(messages):
                response += chunk

            parsed = self._extract_json_from_response(response)

            if parsed:
                importance = self._validate_label(
                    parsed.get("importance_level"), VALID_IMPORTANCE_LEVELS
                )
                impact = self._validate_label(
                    parsed.get("ai_impact"), VALID_IMPACT_VALUES
                )
                confidence = self._validate_label(
                    parsed.get("impact_confidence"), VALID_CONFIDENCE_LEVELS
                )

                update_data = {}
                if importance:
                    update_data["importance_level"] = importance
                if impact:
                    update_data["ai_impact"] = impact
                if confidence:
                    update_data["impact_confidence"] = confidence

                if update_data:
                    repo.update(data=update_data, eq={"id": article_id})

                    # 备份到 SQLite
                    updated_article = repo.select_one(eq={"id": article_id})
                    if updated_article:
                        await backup_to_sqlite([updated_article])

                return {
                    "status": "success",
                    "article_id": article_id,
                    "importance_level": importance,
                    "ai_impact": impact,
                    "impact_confidence": confidence,
                }
            else:
                logger.warning(f"标签 JSON 解析失败: {article_id}")
                return {
                    "status": "failed",
                    "article_id": article_id,
                    "error": "JSON parsing failed",
                }

        except Exception as e:
            logger.error(f"标签文章失败: {article_id}, 错误: {e}")
            raise

    async def translate_pending_articles(
        self, limit: int = 10,
        source_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        """翻译并标签所有待处理的文章"""
        source = source_filter or 'cnbc_jeff_cox'
        repo = get_news_repo()
        articles = repo.select_data(
            eq={"source": source},
            neq={"translation_status": "completed"},
            order="published_at.desc",
            limit=limit,
        )

        stats = {"total": len(articles), "success": 0, "failed": 0}

        for article in articles:
            try:
                await self.translate_and_label_article(article["id"])
                stats["success"] += 1
            except Exception as e:
                logger.error(f"翻译失败 {article['id']}: {e}")
                stats["failed"] += 1

        logger.info(f"批量翻译标签完成: {stats}")
        return stats

    async def label_unlabeled_articles(
        self, limit: int = 10
    ) -> Dict[str, Any]:
        """为已翻译但未标签的文章生成标签"""
        repo = get_news_repo()
        articles = repo.select_data(
            eq={"source": "cnbc_jeff_cox", "translation_status": "completed"},
            is_={"importance_level": "null"},
            order="published_at.desc",
            limit=limit,
        )

        stats = {"total": len(articles), "success": 0, "failed": 0}

        for article in articles:
            try:
                result = await self.label_article(article["id"])
                if result.get("status") == "success":
                    stats["success"] += 1
                else:
                    stats["failed"] += 1
            except Exception as e:
                logger.error(f"标签失败 {article['id']}: {e}")
                stats["failed"] += 1

        logger.info(f"批量标签完成: {stats}")
        return stats


# 全局单例
_translation_service: Optional[TranslationService] = None


def get_translation_service(provider: str = "deepseek") -> TranslationService:
    """获取翻译服务实例"""
    global _translation_service
    if _translation_service is None:
        _translation_service = TranslationService(provider=provider)
    return _translation_service
