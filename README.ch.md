# Tomato Note Graph

[English](README.en.md) · **简体中文**

将**手写笔记照片**或**原始文字**经多模态/对话模型整理为**结构化 Markdown**，并落盘到本机**个人知识库**目录的轻量应用。带 React 网页端上传、轮询任务状态、预览结果与知识库路径配置。可配合浏览器 Markdown 预览扩展（例如 Chrome 上的 *Markdown Viewer* 类插件）实现完全本地、轻量的阅读。

## 能做什么

- **拍照笔记**：上传一张或多张（逐任务单图）常见格式图片，由视觉模型转写为可读 Markdown（标题、列表、粗体等）。
- **纯文字笔记**：同一条任务可改为粘贴原始文字，由模型整理为 Markdown（与上传二选一）。
- **本地知识库**：识别成功后将笔记写入你指定的目录（默认在数据目录下 `knowledge_base/notes/`），并可选维护「知识库索引」等；路径可通过环境变量或 Web 页配置（见下）。

不依赖公网图床：原图与 SQLite 元数据存于本机 `backend/data/`（可通过环境变量改数据目录）。

## 技术栈

| 部分 | 说明 |
|------|------|
| 后端 | Python 3，[FastAPI](https://fastapi.tiangolo.com/)，SQLite 任务表，同步 pipeline 在后台任务中执行 |
| 前端 | React 19、Vite 6；开发时通过 Vite 代理请求后端 |
| 模型 | [OpenAI 兼容 API](https://platform.openai.com/docs/api-reference)：推荐 [OpenRouter](https://openrouter.ai/) 统一路由；也支持直接配置 `OPENAI_*` |

## 目录结构

```
tomato-note-graph/
├── backend/
│   ├── app/           # API、任务存储、知识库、pipeline（worker）
│   ├── .env.example   # 环境变量模板（复制为 .env）
│   └── requirements.txt
├── frontend/          # Vite + React 网页
└── docs/
    └── PIPELINE.md    # 产品/数据流与路线说明（若本地存在，可作为设计参考）
```

## 环境要求

- **Python** 3.10+（建议 3.11+）
- **Node.js** 18+（用于前端构建与开发服务）

## 快速开始

### 1. 配置后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `backend/.env`：至少配置 **OpenRouter** 或 **OpenAI** 其一的 API Key（见 `.env` 内注释）。未配置 Key 时，可通过 `TOMATO_USE_STUB=1` 使用固定假数据联调界面。

启动 API（**端口 8001** 与前端 Vite 代理一致）：

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

浏览器可打开 [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs) 查看自动生成的 OpenAPI 文档。健康检查：[http://127.0.0.1:8001/health](http://127.0.0.1:8001/health)（`vision_mode` 会显示 `openrouter` / `openai` / `stub` / `unconfigured`）。

### 2. 启动前端

新终端中：

```bash
cd frontend
npm install
npm run dev
```

在浏览器打开 **http://127.0.0.1:5173**（Vite 会把 `/api` 与 `/health` 代理到 `http://127.0.0.1:8001`）。

> 请保持后端 8001 与前端 5173 同时运行，否则页面无法调通 API。

## 使用说明（网页）

1. 在「新建任务」中创建任务，**任选其一**：上传手写照片，或粘贴文字后提交文字内容。
2. 点击**开始处理**，等待状态从「待处理 / 处理中」变为「完成」。
3. 在结果区查看渲染后的 **Markdown**；若成功写入知识库，会显示相对知识库根的笔记路径。
4. 在「个人知识库」区块可查看当前根目录、是否由环境变量锁定、以及**保存自定义本机目录**（若未用 `TOMATO_KB_DIR` 锁死则可在界面修改）。也可在界面触发「整理知识库」。

语言可在界面中切换（中英）。

## 常用环境变量

完整列表与说明见 `backend/.env.example`。开发中最常改动的有：

| 变量 | 含义 |
|------|------|
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | OpenRouter 及所用视觉/对话模型 slug |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | 官方或其它兼容基址下的模型名 |
| `TOMATO_DATA_DIR` | 数据与 SQLite 根目录，默认 `backend/data` |
| `TOMATO_KB_DIR` | 强制使用固定知识库目录（设后 Web 不能改） |
| `TOMATO_USE_STUB` / `TOMATO_FORCE_STUB` | 无 Key 或强制走假数据 |
| `TOMATO_CORS_ORIGINS` | 非 5173 的前端源时，逗号分隔加到这里 |

## API 流程概要

1. `POST /api/jobs` → 得到 `job_id`，以及 `upload_path`、`text_path`。
2. `POST` 到对应路径：multipart 上传图片，或 JSON `{"text":"..."}` 提交文字（二选一）。
3. `POST /api/jobs/{job_id}/start` 启动处理。
4. `GET /api/jobs/{job_id}` 轮询直到 `status` 为 `done` 或 `failed`；成功时 `markdown` 为结果正文。