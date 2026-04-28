# Pipeline & data flow

This document describes how a job moves through the system. It complements the **OpenAPI** schema at `http://127.0.0.1:8001/docs` when the backend is running.

## 1. Create input

1. `POST /api/jobs` → returns `job_id`, `upload_path`, and `text_path`.
2. **Either**:
   - `POST` multipart to `upload_path` with an image, **or**
   - `POST` JSON `{"text":"..."}` to `text_path`.

Mutually exclusive: a job cannot have both an image and text.

## 2. Run the worker

3. `POST /api/jobs/{job_id}/start` enqueues work on a FastAPI background task.
4. The worker (see `backend/app/main.py` → `worker` module):
   - Sets status to `processing`.
   - If image: vision chat completion (`backend/app/worker.py` → `run_pipeline`).
   - If text: text-only chat completion → `run_text_pipeline`.
   - On success, writes a Markdown file under the configured knowledge base (`notes/`) and stores the relative path; job status → `done` with `markdown` in the API response.
   - On failure, status → `failed` and `error` is set.

Stub mode: `TOMATO_USE_STUB=1` without an API key returns fixed demo Markdown; `TOMATO_FORCE_STUB=1` always uses stubs (see `worker.py` and `/health` `vision_mode`).

## 3. Knowledge base

- **Root** resolution: `TOMATO_KB_DIR` (env) → `kb_root.json` under `TOMATO_DATA_DIR` → default `{TOMATO_DATA_DIR}/knowledge_base`.
- **Persistence**: SQLite at `{TOMATO_DATA_DIR}/app.db` holds job rows; the column `mindmap_json` stores JSON with `markdown` and optional `kb_note_relative` (historical name, not a mind map).
- **Maintenance**: optional periodic and on-save index rebuild (`知识库索引.md`); can use LLM when keys are set (`knowledge_base.py`).

## 4. Review / study

- `POST /api/study/question` sends note Markdown to the same LLM stack to produce one self-test question (`generate_study_question` in `worker.py`).

## File layout (runtime)

| Path | Role |
|------|------|
| `TOMATO_DATA_DIR` (default: `backend/data/`) | SQLite, uploads, `kb_root.json` |
| Knowledge base root / `notes/*.md` | User-facing notes and front matter |
| `UPLOAD_DIR` under data | Uploaded images (filenames include job id) |

For production, put the app behind HTTPS, restrict CORS (`TOMATO_CORS_ORIGINS`), and add authentication as needed; the stock setup targets local, single-user use.
