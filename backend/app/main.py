from __future__ import annotations

import logging
import os
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.db import JobRow, JobStore
from app.knowledge_base import (
    clear_user_kb_root,
    note_relative_path,
    read_kb_dashboard,
    resolve_kb_root,
    run_kb_maintenance,
    save_note_markdown,
    set_user_kb_root,
)
from app.worker import run_pipeline as run_pipeline_sync

_backend_root = Path(__file__).resolve().parent.parent
load_dotenv(_backend_root / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("TOMATO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "app.db"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
store = JobStore(DB_PATH)

_kb_stop = threading.Event()


def _kb_periodic_worker(data_dir: Path) -> None:
    first = int(os.environ.get("TOMATO_KB_MAINTENANCE_FIRST_DELAY_SEC", "120"))
    interval = int(os.environ.get("TOMATO_KB_MAINTENANCE_INTERVAL_SEC", "86400"))
    if _kb_stop.wait(first):
        return
    while not _kb_stop.is_set():
        try:
            kb_root = resolve_kb_root(data_dir)
            run_kb_maintenance(kb_root)
        except Exception:
            logger.exception("定期知识库维护失败")
        if _kb_stop.wait(interval):
            break


@asynccontextmanager
async def lifespan(app: FastAPI):
    maint = os.environ.get("TOMATO_KB_MAINTENANCE", "1").strip().lower() not in ("0", "false", "no")
    t: threading.Thread | None = None
    if maint:
        t = threading.Thread(target=_kb_periodic_worker, args=(DATA_DIR,), daemon=True, name="tomato-kb-periodic")
        t.start()
    yield
    if maint:
        _kb_stop.set()
        if t is not None:
            t.join(timeout=20.0)


app = FastAPI(title="Tomato Note Graph API", version="0.1.0", lifespan=lifespan)


@app.get("/")
def root() -> dict[str, Any]:
    """避免直接访问根路径 404；Web UI 请用前端 dev server（默认 http://127.0.0.1:5173）。"""
    return {
        "service": "Tomato Note Graph API",
        "docs": "/docs",
        "health": "/health",
        "api": "/api/jobs",
        "knowledge_base": "/api/kb",
    }


_cors_origins = os.environ.get("TOMATO_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateJobResponse(BaseModel):
    job_id: str
    upload_path: str = Field(description="相对 API 根路径，POST multipart 到此地址")


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    created_at: str
    error: str | None = None
    markdown: str | None = None
    kb_note_relative: str | None = Field(
        default=None,
        description="相对知识库根目录的笔记路径（识别成功并落盘后可用）",
    )


class KbRootUpdate(BaseModel):
    path: str = Field(..., min_length=1, description="本机目录绝对路径或带 ~ 的路径")


def _maybe_kb_maintain_on_save(kb_root: Path) -> None:
    on_save = os.environ.get("TOMATO_KB_MAINTENANCE_ON_SAVE", "1").strip().lower() not in ("0", "false", "no")
    if not on_save:
        return

    def _run() -> None:
        try:
            run_kb_maintenance(kb_root)
        except Exception:
            logger.exception("保存后知识库维护失败")

    threading.Thread(target=_run, daemon=True, name="kb-maint-on-save").start()


def _process_job(job_id: str) -> None:
    row = store.get(job_id)
    if row is None or not row.image_path:
        logger.error("process_job: missing job or image job_id=%s", job_id)
        return
    image_path = Path(row.image_path)
    if not image_path.is_file():
        store.set_status(job_id, "failed", error="image_missing")
        return
    store.set_status(job_id, "processing")
    try:
        md = run_pipeline_sync(image_path)
        kb_rel: str | None = None
        kb_root = resolve_kb_root(DATA_DIR)
        try:
            _, kb_rel = save_note_markdown(kb_root, job_id, row.created_at, md)
        except Exception:
            logger.exception("写入本地知识库失败 job_id=%s", job_id)
        store.set_done(job_id, md, kb_note_relative=kb_rel)
        if kb_rel:
            _maybe_kb_maintain_on_save(kb_root)
    except Exception as e:  # noqa: BLE001 — MVP 记录任意失败
        logger.exception("pipeline failed job_id=%s", job_id)
        store.set_status(job_id, "failed", error=str(e))


@app.post("/api/jobs", response_model=CreateJobResponse)
def create_job() -> CreateJobResponse:
    job_id = store.create_job()
    return CreateJobResponse(job_id=job_id, upload_path=f"/api/jobs/{job_id}/upload")


@app.post("/api/jobs/{job_id}/upload")
async def upload_image(job_id: str, file: UploadFile = File(...)) -> dict[str, str]:
    row = store.get(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="job_not_pending")
    ext = Path(file.filename or "image").suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".bmp"}:
        ext = ".jpg"
    dest = UPLOAD_DIR / f"{job_id}_{uuid.uuid4().hex}{ext}"
    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    finally:
        await file.close()
    if not store.set_image_path(job_id, str(dest)):
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="job_not_pending")
    return {"job_id": job_id, "saved": str(dest.name)}


@app.post("/api/jobs/{job_id}/start")
def start_job(job_id: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    row = store.get(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="invalid_state")
    if not row.image_path:
        raise HTTPException(status_code=400, detail="no_image")
    background_tasks.add_task(_process_job, job_id)
    return {"job_id": job_id, "status": "queued"}


def _kb_note_rel_for_row(row: JobRow) -> str | None:
    if row.status != "done" or not row.markdown:
        return None
    if row.kb_note_relative:
        return row.kb_note_relative
    return note_relative_path(row.id, row.created_at)


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    row = store.get(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    return JobStatusResponse(
        job_id=row.id,
        status=row.status,
        created_at=row.created_at,
        error=row.error,
        markdown=row.markdown,
        kb_note_relative=_kb_note_rel_for_row(row),
    )


@app.get("/api/kb")
def get_knowledge_base() -> dict[str, Any]:
    """本机个人知识库目录与维护状态（供前端展示路径）。"""
    return read_kb_dashboard(DATA_DIR)


@app.put("/api/kb/root")
def put_kb_root(body: KbRootUpdate) -> dict[str, Any]:
    """保存自定义知识库根目录到数据目录下的 kb_root.json（可指向仓库外路径）。若已设置 TOMATO_KB_DIR 则拒绝。"""
    try:
        set_user_kb_root(DATA_DIR, body.path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return read_kb_dashboard(DATA_DIR)


@app.delete("/api/kb/root")
def delete_kb_root_config() -> dict[str, Any]:
    """删除 kb_root.json，恢复默认 {data}/knowledge_base（若由 TOMATO_KB_DIR 锁定则拒绝）。"""
    try:
        clear_user_kb_root(DATA_DIR)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return read_kb_dashboard(DATA_DIR)


@app.post("/api/kb/maintain")
def trigger_kb_maintain(background_tasks: BackgroundTasks) -> dict[str, str]:
    """手动触发一次知识库整理（异步执行）。"""

    def _task() -> None:
        try:
            run_kb_maintenance(resolve_kb_root(DATA_DIR))
        except Exception:
            logger.exception("手动知识库维护失败")

    background_tasks.add_task(_task)
    return {"status": "queued"}


@app.get("/health")
def health() -> dict[str, Any]:
    has_or = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
    has_oai = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    has_key = has_or or has_oai
    force_stub = os.environ.get("TOMATO_FORCE_STUB", "").strip().lower() in ("1", "true", "yes")
    stub_env = os.environ.get("TOMATO_USE_STUB", "").strip().lower() in ("1", "true", "yes")
    use_stub = force_stub or (stub_env and not has_key)
    if use_stub:
        mode = "stub"
    elif has_or:
        mode = "openrouter"
    elif has_oai:
        mode = "openai"
    else:
        mode = "unconfigured"
    return {
        "status": "ok",
        "vision_mode": mode,
        "knowledge_base_root": str(resolve_kb_root(DATA_DIR)),
    }
