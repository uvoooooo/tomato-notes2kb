from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
_lock = threading.Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class JobRow:
    id: str
    status: str
    created_at: str
    error: str | None
    image_path: str | None
    markdown: str | None
    kb_note_relative: str | None = None


class JobStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    error TEXT,
                    image_path TEXT,
                    mindmap_json TEXT
                )
                """
            )

    def create_job(self) -> str:
        job_id = str(uuid.uuid4())
        with _lock:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO jobs (id, status, created_at) VALUES (?, ?, ?)",
                    (job_id, "pending", _utc_now_iso()),
                )
        return job_id

    def set_image_path(self, job_id: str, image_path: str) -> bool:
        with _lock:
            with self._connect() as conn:
                cur = conn.execute(
                    "UPDATE jobs SET image_path = ? WHERE id = ? AND status = 'pending'",
                    (image_path, job_id),
                )
                return cur.rowcount == 1

    def set_status(self, job_id: str, status: str, error: str | None = None) -> bool:
        with _lock:
            with self._connect() as conn:
                cur = conn.execute(
                    "UPDATE jobs SET status = ?, error = ? WHERE id = ?",
                    (status, error, job_id),
                )
                return cur.rowcount == 1

    def set_done(self, job_id: str, markdown: str, kb_note_relative: str | None = None) -> None:
        data: dict[str, str] = {"markdown": markdown}
        if kb_note_relative:
            data["kb_note_relative"] = kb_note_relative
        payload = json.dumps(data, ensure_ascii=False)
        with _lock:
            with self._connect() as conn:
                conn.execute(
                    "UPDATE jobs SET status = ?, mindmap_json = ?, error = NULL WHERE id = ?",
                    ("done", payload, job_id),
                )

    def get(self, job_id: str) -> JobRow | None:
        with _lock:
            with self._connect() as conn:
                row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        md: str | None = None
        kb_rel: str | None = None
        raw = row["mindmap_json"]
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                m = parsed.get("markdown")
                if isinstance(m, str) and m.strip():
                    md = m
                kr = parsed.get("kb_note_relative")
                if isinstance(kr, str) and kr.strip():
                    kb_rel = kr.strip()
        return JobRow(
            id=row["id"],
            status=row["status"],
            created_at=row["created_at"],
            error=row["error"],
            image_path=row["image_path"],
            markdown=md,
            kb_note_relative=kb_rel,
        )
