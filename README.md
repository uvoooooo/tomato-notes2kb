# Tomato Note Graph

手写笔记拍照 → 思维导图（MVP 骨架）。设计见 [docs/PIPELINE.md](docs/PIPELINE.md)。

## 运行方式

需要本机已安装 **Python 3.11+** 与 **Node.js 20+**。

### 1. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

数据目录默认：`backend/data/`（SQLite `app.db`、上传图片 `uploads/`）。可通过环境变量 `TOMATO_DATA_DIR` 覆盖。

### 2. 前端

新终端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 Vite 提示的地址（一般为 `http://127.0.0.1:5173`）。开发模式下 `/api` 会代理到 `http://127.0.0.1:8000`。

### 3. 试用

在页面选择一张图片 → 自动创建任务、上传、`start`、轮询 → 展示 **stub** 思维导图 JSON（尚未接真实多模态/OCR）。

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/jobs` | 创建任务，返回 `job_id` 与 `upload_path` |
| POST | `/api/jobs/{id}/upload` | `multipart/form-data`，字段名 `file` |
| POST | `/api/jobs/{id}/start` | 入队处理（当前为进程内 BackgroundTasks） |
| GET | `/api/jobs/{id}` | 查询状态；`done` 时含 `mindmap_json` |
