"""
Robust JSON extraction from raw LLM output.
Handles: direct JSON, markdown code blocks, embedded JSON, partial output.
"""
from __future__ import annotations
import json
import re
import logging
from typing import Type, TypeVar
from pydantic import BaseModel

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


def parse_skill_output(raw: str, schema: Type[T]) -> tuple[T | None, str]:
    """
    Three-step JSON extraction with Pydantic validation.

    Returns:
        (parsed_model | None, status)
        status: "structured" | "partial" | "raw_only"

    All schema fields have defaults, so model_validate rarely fails on partial data.
    """
    text = raw.strip()

    # Step 1: Direct parse (cleanest case — Claude/GPT usually hit this)
    try:
        return schema.model_validate(json.loads(text)), "structured"
    except Exception:
        pass

    # Step 2: Strip markdown code block  ```json ... ```
    md = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if md:
        try:
            return schema.model_validate(json.loads(md.group(1))), "structured"
        except Exception:
            pass

    # Step 3: Extract outermost { ... } (greedy — for models that prefix with text)
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        try:
            return schema.model_validate(json.loads(brace.group(0))), "partial"
        except Exception:
            # JSON valid but schema validation failed — use model defaults + log
            try:
                raw_dict = json.loads(brace.group(0))
                instance = schema.model_validate({k: v for k, v in raw_dict.items()
                                                  if k in schema.model_fields})
                return instance, "partial"
            except Exception:
                pass

    logger.warning(f"[parser] {schema.__name__}: all parsing failed. raw[:120]={text[:120]!r}")
    return None, "raw_only"
