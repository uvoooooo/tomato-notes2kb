from __future__ import annotations

import logging
import os
import shutil
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.db import JobStore
from app.worker import run_pipeline as run_pipeline_sync

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("TOMATO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "app.db"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
store = JobStore(DB_PATH)

app = FastAPI(title="Tomato Note Graph API", version="0.1.0")

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
    mindmap_json: dict | None = None


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
        mindmap = run_pipeline_sync(image_path)
        store.set_done(job_id, mindmap)
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
        mindmap_json=row.mindmap_json,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
