from __future__ import annotations

from pathlib import Path
from typing import Any


def stub_mindmap_from_image(_image_path: Path) -> dict[str, Any]:
    """M0: 占位「识别」——后续替换为多模态/OCR pipeline。"""
    return {
        "title": "演示笔记（stub）",
        "nodes": [
            {"id": "1", "text": "根主题", "children": ["2", "3"]},
            {"id": "2", "text": "分支 A", "children": []},
            {"id": "3", "text": "分支 B", "children": ["4"]},
            {"id": "4", "text": "子点", "children": []},
        ],
    }


def run_pipeline(image_path: Path) -> dict[str, Any]:
    """同步 pipeline 入口；接入外部 API 时可改为内部调用 httpx/async 并由 worker 进程执行。"""
    return stub_mindmap_from_image(image_path)
