from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from openai import OpenAI

from app.worker import chat_model_name, has_llm_credentials, openai_client

logger = logging.getLogger(__name__)

NOTES_SUBDIR = "notes"
INDEX_FILENAME = "知识库索引.md"
STATE_FILENAME = ".kb_state.json"
KB_ROOT_SETTINGS_FILENAME = "kb_root.json"

RootSource = Literal["env", "user_config", "default"]

_kb_lock = threading.Lock()
_kb_root_file_lock = threading.Lock()


def kb_root_settings_path(data_dir: Path) -> Path:
    """用户自定义根目录写入位置（在 TOMATO_DATA_DIR 下，可与代码仓库分离）。"""
    return data_dir.resolve() / KB_ROOT_SETTINGS_FILENAME


def kb_root_locked_by_env() -> bool:
    return bool(os.environ.get("TOMATO_KB_DIR", "").strip())


def resolve_kb_root_meta(data_dir: Path) -> tuple[Path, RootSource, bool]:
    """解析知识库根目录：(路径, 来源, 是否允许通过 API/UI 修改).

    优先级：环境变量 TOMATO_KB_DIR > 用户配置文件 kb_root.json > 默认 {data_dir}/knowledge_base
    """
    data_dir = data_dir.resolve()
    with _kb_root_file_lock:
        env = os.environ.get("TOMATO_KB_DIR", "").strip()
        if env:
            p = Path(env).expanduser().resolve()
            return p, "env", False

        cfg = kb_root_settings_path(data_dir)
        if cfg.is_file():
            try:
                data = json.loads(cfg.read_text(encoding="utf-8"))
                raw = (data.get("root") or "").strip() if isinstance(data, dict) else ""
                if raw:
                    p = Path(raw).expanduser().resolve()
                    return p, "user_config", True
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                logger.warning("读取知识库路径配置失败: %s，将使用默认目录", cfg)

        p = (data_dir / "knowledge_base").resolve()
        return p, "default", True


def resolve_kb_root(data_dir: Path) -> Path:
    """个人知识库根目录；可指向仓库外任意本机路径（见 resolve_kb_root_meta）。"""
    p, _, _ = resolve_kb_root_meta(data_dir)
    return p


def set_user_kb_root(data_dir: Path, path_str: str) -> Path:
    """将自定义根目录写入 kb_root.json（要求未设置 TOMATO_KB_DIR）。"""
    if kb_root_locked_by_env():
        raise ValueError("知识库根目录已由环境变量 TOMATO_KB_DIR 固定，请改 .env 并重启服务。")
    raw = path_str.strip()
    if not raw:
        raise ValueError("路径不能为空")
    try:
        resolved = Path(raw).expanduser().resolve()
    except (OSError, RuntimeError) as e:
        raise ValueError(f"无效路径: {e}") from e
    if resolved.is_file():
        raise ValueError("路径指向文件，请指定目录")
    resolved.mkdir(parents=True, exist_ok=True)
    data_dir = data_dir.resolve()
    cfg = kb_root_settings_path(data_dir)
    payload = json.dumps({"root": str(resolved)}, ensure_ascii=False, indent=2) + "\n"
    with _kb_root_file_lock:
        cfg.write_text(payload, encoding="utf-8")
    logger.info("已保存用户知识库根目录: %s", resolved)
    return resolved


def clear_user_kb_root(data_dir: Path) -> None:
    """删除 kb_root.json，恢复为默认 {data_dir}/knowledge_base（要求未设置 TOMATO_KB_DIR）。"""
    if kb_root_locked_by_env():
        raise ValueError("知识库根目录已由环境变量 TOMATO_KB_DIR 固定，无法通过界面清除。")
    cfg = kb_root_settings_path(data_dir.resolve())
    with _kb_root_file_lock:
        cfg.unlink(missing_ok=True)
    logger.info("已清除知识库路径配置文件，将使用默认目录")


def note_relative_path(job_id: str, created_at_iso: str) -> str:
    """旧版确定性路径（无内容标题时）；新任务请使用落盘时写入的 kb_note_relative。"""
    stem = _note_stem(job_id, created_at_iso)
    return f"{NOTES_SUBDIR}/{stem}.md"


def _note_stem(job_id: str, created_at_iso: str) -> str:
    day = created_at_iso[:10] if len(created_at_iso) >= 10 else "unknown"
    short = job_id.replace("-", "")[:8]
    return f"{day}_{short}"


def _note_name_max_len() -> int:
    return max(16, min(200, int(os.environ.get("TOMATO_KB_NOTE_NAME_MAX_LEN", "72"))))


def _sanitize_note_stem(raw: str, max_len: int) -> str:
    """文件名主体：允许中文，去掉路径非法字符与首尾空白。"""
    s = raw.replace("\n", " ").replace("\r", " ")
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, "")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(". ")
    if len(s) > max_len:
        s = s[:max_len].rstrip()
    return s


def _topic_hint_from_markdown(markdown: str) -> str | None:
    """从正文推断知识点标题：优先一级标题，否则取首条非空正文行。"""
    h = _first_heading_line(markdown)
    if h:
        return h
    body = _strip_yaml_frontmatter(markdown).strip()
    for line in body.splitlines():
        t = line.strip()
        if not t:
            continue
        if t.startswith("#"):
            continue
        if t in ("---", "***", "___"):
            continue
        return t
    return None


def suggest_note_filename_stem(markdown: str, job_id: str, created_at_iso: str) -> str:
    """根据笔记内容生成文件名主体（不含 .md，未做唯一性处理）。"""
    max_len = _note_name_max_len()
    job_short = job_id.replace("-", "")[:8]
    topic = _topic_hint_from_markdown(markdown)
    if topic:
        stem = _sanitize_note_stem(topic, max_len)
        if stem:
            return stem
    day = created_at_iso[:10] if len(created_at_iso) >= 10 else "unknown"
    return f"笔记-{day}-{job_short}"


def _iter_candidate_filenames(stem: str, job_short: str):
    """同名冲突时依次尝试加任务 id 后缀与序号。"""
    yield f"{stem}.md"
    yield f"{stem}_{job_short}.md"
    n = 2
    while True:
        yield f"{stem}_{job_short}_{n}.md"
        n += 1


def _pick_unique_note_path(notes_dir: Path, stem: str, job_short: str) -> Path:
    stem = stem or f"笔记-{job_short}"
    for fname in _iter_candidate_filenames(stem, job_short):
        p = notes_dir / fname
        if not p.exists():
            return p
    raise OSError("无法分配唯一笔记文件名")


def _strip_yaml_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    if len(parts) >= 3:
        return parts[2].lstrip("\n")
    return text


def _first_heading_line(text: str) -> str | None:
    body = _strip_yaml_frontmatter(text)
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip() or None
    return None


def save_note_markdown(
    kb_root: Path,
    job_id: str,
    created_at_iso: str,
    markdown: str,
    *,
    source: str = "handwritten-photo",
) -> tuple[Path, str]:
    """将识别结果写入知识库 notes 目录；文件名由知识点内容推断。

    返回 (绝对路径, 相对知识库根的路径，如 notes/微积分-复习.md)。
    """
    notes = kb_root / NOTES_SUBDIR
    notes.mkdir(parents=True, exist_ok=True)
    job_short = job_id.replace("-", "")[:8]
    stem = suggest_note_filename_stem(markdown, job_id, created_at_iso)
    path = _pick_unique_note_path(notes, stem, job_short)
    fm = (
        "---\n"
        f'job_id: "{job_id}"\n'
        f"created_at: {created_at_iso}\n"
        f"source: {source}\n"
        "---\n\n"
    )
    path.write_text(fm + markdown.strip() + "\n", encoding="utf-8")
    rel = path.resolve().relative_to(kb_root.resolve()).as_posix()
    logger.info("已写入知识库笔记: %s (%s)", path, rel)
    return path, rel


def _list_note_paths(kb_root: Path) -> list[Path]:
    d = kb_root / NOTES_SUBDIR
    if not d.is_dir():
        return []
    return sorted(d.glob("*.md"))


def _build_manifest_for_llm(kb_root: Path) -> tuple[str, int]:
    """供维护任务使用的纯文本清单；控制总长度避免撑爆上下文。"""
    paths = _list_note_paths(kb_root)
    max_per = int(os.environ.get("TOMATO_KB_MANIFEST_PER_NOTE_CHARS", "1500"))
    max_total = int(os.environ.get("TOMATO_KB_MANIFEST_MAX_CHARS", "28000"))
    chunks: list[str] = []
    total = 0
    n = 0
    for p in paths:
        rel = p.relative_to(kb_root).as_posix()
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        title = _first_heading_line(raw) or p.stem
        body = _strip_yaml_frontmatter(raw).strip()
        excerpt = body[:max_per]
        if len(body) > max_per:
            excerpt += "\n…（摘录截断）"
        block = f"### 文件: `{rel}`\n**推测标题**: {title}\n\n{excerpt}\n\n---\n"
        if total + len(block) > max_total:
            chunks.append(f"\n（另有 {len(paths) - n} 个文件未列入本次维护上下文；可缩短单篇笔记或调大 TOMATO_KB_MANIFEST_MAX_CHARS）\n")
            break
        chunks.append(block)
        total += len(block)
        n += 1
    return "".join(chunks), len(paths)


_MAINT_SYSTEM = """你是个人知识库管理员。用户有多条由手写笔记识别得到的 Markdown 文件，存放在 notes/ 目录。
请根据下方「笔记清单与摘录」生成**一份**面向用户阅读的《知识库索引》Markdown 文档。

要求：
- 使用清晰的中文（专有名词可保留英文）。
- 包含：总览（笔记条数、大致覆盖主题）、按主题/场景分组的导航（用 Markdown 相对链接指向 `./notes/文件名.md`）、**整理建议**（可合并的相近主题、命名建议、可选的标签体系）。
- 不要编造笔记中不存在的事实；若摘录不足，可写「待补充」。
- 只输出 Markdown 正文，不要用代码围栏包裹全文。"""


def _strip_outer_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return text


def _fallback_index_markdown(kb_root: Path, note_count: int) -> str:
    paths = _list_note_paths(kb_root)
    lines = [
        "# 知识库索引（自动维护）",
        "",
        f"- 笔记条数: **{note_count}**",
        f"- 本索引更新时间: {datetime.now(timezone.utc).replace(microsecond=0).isoformat()}",
        "",
        "当前未调用 LLM 深度整理（无 API Key 或已关闭文本整理）。以下为条目列表：",
        "",
    ]
    for p in paths:
        rel = p.relative_to(kb_root).as_posix()
        title = p.stem
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
            h = _first_heading_line(raw)
            if h:
                title = h
        except OSError:
            pass
        lines.append(f"- [{title}](./{rel})")
    lines.append("")
    lines.append("配置 `OPENROUTER_API_KEY` 或 `OPENAI_API_KEY` 并启用维护后，将生成带主题分组与整理建议的索引。")
    lines.append("")
    return "\n".join(lines)


def _write_state(kb_root: Path, payload: dict[str, Any]) -> None:
    path = kb_root / STATE_FILENAME
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_kb_maintenance(kb_root: Path) -> None:
    """扫描 notes/，重写根目录「知识库索引.md」；在可用时调用 LLM 做主题整理。"""
    kb_root.mkdir(parents=True, exist_ok=True)
    (kb_root / NOTES_SUBDIR).mkdir(parents=True, exist_ok=True)

    with _kb_lock:
        paths = _list_note_paths(kb_root)
        note_count = len(paths)

        if note_count == 0:
            body = (
                "# 知识库索引\n\n"
                "暂无笔记。上传手写照片并成功识别后，内容会保存到 `notes/` 目录。\n"
            )
            (kb_root / INDEX_FILENAME).write_text(body, encoding="utf-8")
            _write_state(
                kb_root,
                {
                    "last_maintenance_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                    "ok": True,
                    "mode": "empty",
                    "note_count": 0,
                },
            )
            logger.info("知识库维护：无笔记，已写入空索引")
            return

        use_llm = has_llm_credentials()
        force_stub = os.environ.get("TOMATO_FORCE_STUB", "").strip().lower() in ("1", "true", "yes")
        llm_off = os.environ.get("TOMATO_KB_MAINTENANCE_LLM", "1").strip().lower() in ("0", "false", "no")
        if force_stub or not use_llm or llm_off:
            body = _fallback_index_markdown(kb_root, note_count)
            mode = "fallback"
        else:
            manifest, _ = _build_manifest_for_llm(kb_root)
            user_msg = (
                f"知识库根路径对应的工作区中，已有 {note_count} 条笔记在 `{NOTES_SUBDIR}/`。\n\n"
                "## 笔记清单与摘录\n\n"
                f"{manifest}\n\n"
                "请生成《知识库索引》全文（单个 Markdown 文档）。"
            )
            maint_model = os.environ.get("TOMATO_KB_MAINTENANCE_MODEL", "").strip() or chat_model_name()
            max_tok = int(os.environ.get("TOMATO_KB_MAINTENANCE_MAX_TOKENS", "4096"))
            try:
                client: OpenAI = openai_client()
                completion = client.chat.completions.create(
                    model=maint_model,
                    messages=[
                        {"role": "system", "content": _MAINT_SYSTEM},
                        {"role": "user", "content": user_msg},
                    ],
                    max_tokens=max_tok,
                    temperature=0.3,
                )
                raw = (completion.choices[0].message.content or "").strip()
                body = _strip_outer_fence(raw)
                if not body:
                    raise ValueError("empty_maintenance_output")
                mode = "llm"
            except Exception as e:
                logger.warning("知识库 LLM 整理失败，使用回退索引: %s", e)
                body = _fallback_index_markdown(kb_root, note_count)
                mode = "fallback_after_error"

        (kb_root / INDEX_FILENAME).write_text(body + "\n", encoding="utf-8")
        _write_state(
            kb_root,
            {
                "last_maintenance_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "ok": True,
                "mode": mode,
                "note_count": note_count,
            },
        )
        logger.info("知识库维护完成: mode=%s notes=%s", mode, note_count)


def read_kb_dashboard(data_dir: Path) -> dict[str, Any]:
    """供 GET /api/kb 返回的路径与状态摘要。"""
    kb_root, source, editable = resolve_kb_root_meta(data_dir)
    kb_root = kb_root.resolve()
    state_path = kb_root / STATE_FILENAME
    state: dict[str, Any] = {}
    if state_path.is_file():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            state = {}
    note_count = len(_list_note_paths(kb_root))
    dd = data_dir.resolve()
    return {
        "root": str(kb_root),
        "notes_subdir": str((kb_root / NOTES_SUBDIR).resolve()),
        "index_file": INDEX_FILENAME,
        "index_path": str((kb_root / INDEX_FILENAME).resolve()),
        "note_count": note_count,
        "last_maintenance_at": state.get("last_maintenance_at"),
        "last_maintenance_mode": state.get("mode"),
        "root_source": source,
        "root_editable_via_ui": editable,
        "kb_settings_file": str(kb_root_settings_path(dd)),
    }
