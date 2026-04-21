from __future__ import annotations

import base64
import json
import logging
import os
import re
from io import BytesIO
from pathlib import Path

from openai import APIStatusError, OpenAI
from PIL import Image

logger = logging.getLogger(__name__)

_MAX_EDGE_PX = int(os.environ.get("TOMATO_IMAGE_MAX_EDGE", "2048"))
_MAX_TOKENS = int(os.environ.get("TOMATO_MAX_TOKENS", "8192"))
_DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
_DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini"

_SYSTEM = """你是手写笔记整理助手。用户上传一张手写笔记的照片。
请仔细阅读图中所有可读的手写文字（中文或英文），整理成结构清晰的 Markdown。
只输出 Markdown 正文，不要前言、后记或解释性文字。"""

_USER = """任务：
1. 识别图中手写内容，按阅读顺序与版面层级转写；看不清的字用「（模糊）」标出。
2. 使用恰当的 Markdown 语法：第一行尽量用一级标题「# …」概括本页核心知识点（便于保存为文件名），其下可用列表、**粗体**、分段等表达层级。
3. 保持简洁可读；不要编造图中没有的内容。

直接输出 Markdown；不要用 markdown 代码围栏包裹全文。"""


class VisionNotConfiguredError(RuntimeError):
    """未配置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 时抛出。"""


def _mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
    }.get(ext, "image/jpeg")


def _image_bytes_for_api(path: Path) -> tuple[bytes, str]:
    """将图片转为适合 vision API 的字节与 MIME；大图会缩小长边以控体积。"""
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            max_edge = max(w, h)
            if max_edge > _MAX_EDGE_PX and max_edge > 0:
                scale = _MAX_EDGE_PX / max_edge
                im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
            out = BytesIO()
            im.save(out, format="JPEG", quality=88, optimize=True)
            return out.getvalue(), "image/jpeg"
    except Exception:
        logger.warning("PIL 处理失败，使用原文件 bytes: %s", path, exc_info=True)
        data = path.read_bytes()
        return data, _mime_for_path(path)


def _using_openrouter() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip())


def _resolve_model() -> str:
    """OpenRouter 使用 `厂商/模型` slug；官方 OpenAI 使用短名如 gpt-4o-mini。"""
    if _using_openrouter():
        m = os.environ.get("OPENROUTER_MODEL", "").strip()
        if m:
            return m
        m = os.environ.get("OPENAI_MODEL", "").strip()
        if m:
            return m
        return _DEFAULT_OPENROUTER_MODEL
    m = os.environ.get("OPENAI_MODEL", "").strip()
    return m or _DEFAULT_OPENAI_MODEL


def _build_client() -> OpenAI:
    or_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if or_key:
        base = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip().rstrip("/")
        headers: dict[str, str] = {}
        referer = os.environ.get("OPENROUTER_HTTP_REFERER", "http://localhost:5173").strip()
        title = os.environ.get("OPENROUTER_APP_TITLE", "Tomato Note Graph").strip()
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-Title"] = title
        kw: dict[str, object] = {"api_key": or_key, "base_url": f"{base}/"}
        if headers:
            kw["default_headers"] = headers
        return OpenAI(**kw)

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise VisionNotConfiguredError(
            "未配置 OPENROUTER_API_KEY 或 OPENAI_API_KEY。请在 backend/.env 中设置其一，参见 README。"
        )
    base = os.environ.get("OPENAI_BASE_URL", "").strip()
    kwargs: dict[str, object] = {"api_key": key}
    if base:
        kwargs["base_url"] = base.rstrip("/") + "/"
    return OpenAI(**kwargs)


def _format_api_error(e: Exception) -> str:
    if isinstance(e, APIStatusError):
        parts = [str(e.status_code), getattr(e, "message", "") or ""]
        body = getattr(e, "body", None)
        if body is not None:
            try:
                parts.append(json.dumps(body, ensure_ascii=False)[:2000] if isinstance(body, (dict, list)) else str(body)[:2000])
            except Exception:
                parts.append(str(body)[:2000])
        return " | ".join(p for p in parts if p)
    return f"{type(e).__name__}: {e}"


def _strip_outer_code_fence(text: str) -> str:
    """若模型仍用 ```markdown 包裹，去掉最外层围栏。"""
    text = text.strip()
    m = re.match(r"^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return text


def _vision_markdown(image_bytes: bytes, mime: str) -> str:
    client = _build_client()
    model = _resolve_model()
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    attempts: list[tuple[str, dict[str, object]]] = [
        ("plain", {"user_suffix": "", "temperature": None}),
        ("retry_hint", {"user_suffix": "\n\n务必只输出 Markdown 正文，勿加说明。", "temperature": 0.2}),
        ("low_temp", {"user_suffix": "\n\n只输出 Markdown。", "temperature": 0.1}),
    ]

    last_err: Exception | None = None
    for name, cfg in attempts:
        try:
            kwargs: dict[str, object] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": _SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _USER + str(cfg["user_suffix"])},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                "max_tokens": _MAX_TOKENS,
            }
            if cfg["temperature"] is not None:
                kwargs["temperature"] = cfg["temperature"]

            completion = client.chat.completions.create(**kwargs)
            raw = (completion.choices[0].message.content or "").strip()
            text = _strip_outer_code_fence(raw)
            if not text:
                raise ValueError("model_returned_empty_content")
            return text
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("vision 策略 %s 失败: %s", name, _format_api_error(e))

    assert last_err is not None
    raise RuntimeError(_format_api_error(last_err)) from last_err


def _stub_markdown() -> str:
    """仅当设置 TOMATO_USE_STUB=1 时使用，便于无 Key 联调 UI。"""
    return (
        "# 演示笔记（stub）\n\n"
        "- **根主题**\n"
        "  - 分支 A\n"
        "  - 分支 B\n"
        "    - 子点\n"
    )


def _has_vision_key() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip()) or bool(
        os.environ.get("OPENAI_API_KEY", "").strip()
    )


def openai_client() -> OpenAI:
    """供文本类任务（如知识库定期整理）复用同一 OpenAI 兼容客户端。"""
    return _build_client()


def chat_model_name() -> str:
    """当前 Chat Completions 使用的模型名。"""
    return _resolve_model()


def has_llm_credentials() -> bool:
    """是否配置了可调 LLM 的 API Key（含知识库维护等文本任务）。"""
    return _has_vision_key()


def run_pipeline(image_path: Path) -> str:
    """从手写笔记图片生成 Markdown 文本；需 OPENROUTER_API_KEY 或 OPENAI_API_KEY。"""
    if not image_path.is_file():
        raise FileNotFoundError(str(image_path))

    force_stub = os.environ.get("TOMATO_FORCE_STUB", "").strip().lower() in ("1", "true", "yes")
    stub_env = os.environ.get("TOMATO_USE_STUB", "").strip().lower() in ("1", "true", "yes")

    if force_stub:
        logger.info("TOMATO_FORCE_STUB：使用占位 Markdown")
        return _stub_markdown()

    if stub_env and not _has_vision_key():
        return _stub_markdown()

    if stub_env and _has_vision_key():
        logger.warning(
            "已配置 API Key，已忽略 TOMATO_USE_STUB，将调用真实识别。"
            " 若在无 Key 环境需要假数据可保留 TOMATO_USE_STUB；"
            " 若在有 Key 时仍要假数据请改用 TOMATO_FORCE_STUB=1。"
        )

    blob, mime = _image_bytes_for_api(image_path)
    return _vision_markdown(blob, mime)
