# Tomato Note Graph

**English** · [简体中文](README.ch.md)

Turn **handwritten note photos** or **raw text** into **structured Markdown** with a vision/chat model, then save the output to a local **personal knowledge base**. Includes a React web UI for uploads, job polling, preview, and knowledge-base path settings. You can also open the generated files with a Markdown preview extension (e.g. a *Markdown Viewer*–style plugin for Chrome) for fully local, lightweight reading.

## What it does

- **Photo notes**: Upload a common image format (one image per job) and have a vision model transcribe it into readable Markdown (headings, lists, bold, etc.).
- **Plain text notes**: For the same job, paste text instead, and a model will structure it as Markdown (choose either upload or text, not both).
- **Local knowledge base**: On success, notes are written under a directory you configure (by default `knowledge_base/notes/` under the data directory), with optional maintenance of a “knowledge index” and related files; the path is configurable via environment variables or the web UI (see below).
- **Review / quiz**: A separate “Review” card lets you study. Load an existing `notes/*.md` from the vault, or paste any Markdown, then the LLM draws a short self-test question from that text. You can reveal the original text to check your answer and draw a new question. (Uses the same API key as the rest of the app; `TOMATO_USE_STUB=1` uses fixed demo questions when no key is configured.)

No public image hosting required: originals and SQLite metadata live under `backend/data/` on your machine (the data directory can be changed with env vars).

## Stack

| Part | Description |
|------|-------------|
| Backend | Python 3, [FastAPI](https://fastapi.tiangolo.com/), SQLite for jobs, pipeline runs in a background task |
| Frontend | React 19, Vite 6; dev server proxies API calls to the backend |
| Models | [OpenAI-compatible API](https://platform.openai.com/docs/api-reference); [OpenRouter](https://openrouter.ai/) is recommended; you can also set `OPENAI_*` directly |

## Repository layout

```
tomato-note-graph/
├── backend/
│   ├── app/           # API, job store, knowledge base, worker pipeline
│   ├── .env.example   # Copy to .env
│   └── requirements.txt
├── frontend/          # Vite + React
└── docs/
    └── PIPELINE.md    # Product / data-flow
```

## Requirements

- **Python** 3.10+ (3.11+ recommended)
- **Node.js** 18+ (for the frontend dev server and build)

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and set at least an **OpenRouter** or **OpenAI** API key (see inline comments in `.env`). If no key is set, `TOMATO_USE_STUB=1` uses fixed mock data to exercise the UI.

Start the API on **port 8001** (must match the Vite proxy):

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Open [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs) for the OpenAPI UI. Health: [http://127.0.0.1:8001/health](http://127.0.0.1:8001/health) — `vision_mode` is one of `openrouter`, `openai`, `stub`, or `unconfigured`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173** — Vite proxies `/api` and `/health` to `http://127.0.0.1:8001`.

> Run the backend (8001) and the dev server (5173) at the same time, or the page cannot reach the API.

## Using the web UI

1. Create a job under “New job”, then **either** upload a handwritten photo **or** paste text and submit.
2. Click **Start** and wait until the status goes from pending/processing to done.
3. Read the rendered **Markdown** in the result area; if a note was saved, you’ll see the path relative to the knowledge base root.
4. Under “Personal knowledge base” you can inspect the root, whether the path is locked by an environment variable, and **save a custom local path** (unless `TOMATO_KB_DIR` is set, which prevents UI changes). You can also trigger knowledge-base maintenance from the UI.
5. In the **Review** section (below “Add a note”): pick a file from the vault or paste text, then **Draw a question** / **New question**; use **View original** to see the full note. After a successful recognition job, you can also **Open in review** to copy that result into the Review area.

The UI supports Chinese and English.

## Common environment variables

The full list is in `backend/.env.example`. Frequently used:

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | OpenRouter and model slug (vision/chat) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI (or compatible) base and model name |
| `TOMATO_DATA_DIR` | Data and SQLite root; default `backend/data` |
| `TOMATO_KB_DIR` | Fix the knowledge base directory; cannot be changed from the web UI when set |
| `TOMATO_USE_STUB` / `TOMATO_FORCE_STUB` | Use mock data without a key, or force stub even with a key |
| `TOMATO_CORS_ORIGINS` | Comma-separated origins if the frontend is not on port 5173 |

## API flow (summary)

1. `POST /api/jobs` → `job_id`, `upload_path`, and `text_path`.
2. `POST` to the right path: multipart file upload, **or** JSON `{"text":"..."}` (mutually exclusive).
3. `POST /api/jobs/{job_id}/start` to enqueue processing.
4. `GET /api/jobs/{job_id}` until `status` is `done` or `failed`; on success, `markdown` contains the result.

**Knowledge base & review**

- `GET /api/kb` — dashboard (paths, note count, maintenance state).
- `GET /api/kb/notes` — list `notes/*.md` in the vault; `GET /api/kb/notes/content?path=notes/....md` — read one file (path validated, no traversal).
- `POST /api/study/question` with JSON `{"markdown":"...","locale":"zh"|"en"}` — returns `{"question":"..."}` for the self-test (same LLM as note processing).

Request/response models match the **interactive OpenAPI** at `http://127.0.0.1:8001/docs` (path `/docs` on the API server, not a folder in this repo). Human-readable pipeline notes: [docs/PIPELINE.md](docs/PIPELINE.md).

## Production build

Run `cd frontend && npm run build` — static files go to `frontend/dist/`. You must serve them behind a reverse proxy (or the same host) that forwards `/api` (and related routes) to the FastAPI app; the dev server proxy is only for local use.

Harden the backend (HTTPS, CORS, auth) according to your environment; `uvicorn` in production is usually managed by a process supervisor.

## License

[MIT](LICENSE) — see the file for the full text.
