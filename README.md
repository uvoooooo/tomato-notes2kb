# Tomato Notes2KB

手写笔记拍照 → **Markdown 文本**（MVP 骨架）。设计见 [docs/PIPELINE.md](docs/PIPELINE.md)。

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

**个人知识库（本机 Markdown）**

识别成功的笔记会写入知识库目录（默认可在 `backend/data/knowledge_base/`），结构大致为：

- `notes/<知识点标题>.md`：单条笔记（文件名由正文标题或首行内容自动推断，冲突时加任务 id 后缀；含 YAML 头信息 + 正文）
- `知识库索引.md`：由**维护任务**生成的总览（主题分组、相对链接、整理建议）
- `.kb_state.json`：最近一次维护时间与模式（机器可读，可忽略）

知识库根目录**可放在代码仓库之外**（任意本机文件夹）。生效优先级：

1. 环境变量 **`TOMATO_KB_DIR`**（若设置则唯一生效，适合部署/脚本固定路径）  
2. 否则读取数据目录下的 **`kb_root.json`**（可在 Web 页「个人知识库」里填写路径并保存，或通过 `PUT /api/kb/root` 写入）  
3. 若以上皆无，则默认为 **`{TOMATO_DATA_DIR}/knowledge_base`**

`kb_root.json` 只存一条绝对路径字符串，笔记与索引均写入该路径；配置本身位于数据目录（默认 `backend/data/kb_root.json`，已被 `.gitignore` 忽略），不会污染仓库。

#### 手写识别（真实内容）

通过 **OpenAI 兼容** Chat Completions（vision）识别手写并整理为 **Markdown**。推荐 [OpenRouter](https://openrouter.ai/) 统一路由模型；也可直连 OpenAI 官方。

**OpenRouter（推荐）**

| 变量 | 说明 |
|------|------|
| `OPENROUTER_API_KEY` | **与 OpenAI 二选一**（若同时配置，优先使用 OpenRouter） |
| `OPENROUTER_BASE_URL` | 可选，默认 `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | 可选，默认 `openai/gpt-4o-mini`（须支持 vision；slug 见 [OpenRouter 模型列表](https://openrouter.ai/models)） |
| `OPENROUTER_APP_TITLE` | 可选，请求头 `X-Title`，默认 `Tomato Note Graph` |
| `OPENROUTER_HTTP_REFERER` | 可选，请求头 `HTTP-Referer`，默认 `http://localhost:5173` |

也可用 `OPENAI_MODEL` 指定 OpenRouter 上的模型 slug（与 `OPENROUTER_MODEL` 二选一，优先 `OPENROUTER_MODEL`）。

**OpenAI 官方 / 其他兼容接口**

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 未配置 `OPENROUTER_API_KEY` 时使用 |
| `OPENAI_BASE_URL` | 可选，默认官方 |
| `OPENAI_MODEL` | 可选，默认 `gpt-4o-mini` |

**通用**

| 变量 | 说明 |
|------|------|
| `TOMATO_USE_STUB` | 无 API Key 时返回固定假数据；**若已配置 Key 则忽略此项**（避免误留 `=1` 一直出假数据） |
| `TOMATO_FORCE_STUB` | 设为 `1` 时**即使**有 Key 也返回假数据（仅调试） |
| `TOMATO_IMAGE_MAX_EDGE` | 可选，上传图长边缩小上限（像素），默认 `2048` |
| `TOMATO_MAX_TOKENS` | 可选，多模态回复上限，默认 `8192`（避免长笔记输出被截断） |

**知识库与定期整理**

| 变量 | 说明 |
|------|------|
| `TOMATO_KB_DIR` | 可选，**强制**知识库根目录（若设置则忽略 `kb_root.json` 与界面配置）；可指向仓库外绝对路径 |
| `TOMATO_KB_MAINTENANCE` | 可选，设为 `0` 可关闭**后台定期**整理线程（仍可用 `POST /api/kb/maintain` 手动触发） |
| `TOMATO_KB_MAINTENANCE_FIRST_DELAY_SEC` | 可选，启动后首次整理延迟（秒），默认 `120` |
| `TOMATO_KB_MAINTENANCE_INTERVAL_SEC` | 可选，定期整理周期（秒），默认 `86400`（一天） |
| `TOMATO_KB_MAINTENANCE_ON_SAVE` | 可选，每条笔记落盘后是否**再触发一次**整理（默认 `1`；频繁上传且在意费用可设 `0`） |
| `TOMATO_KB_MAINTENANCE_LLM` | 可选，设为 `0` 时维护任务**不调用 LLM**，只生成基于文件列表的简单索引 |
| `TOMATO_KB_MAINTENANCE_MODEL` | 可选，整理索引所用文本模型，默认与 `OPENROUTER_MODEL` / `OPENAI_MODEL` 相同 |
| `TOMATO_KB_MAINTENANCE_MAX_TOKENS` | 可选，整理输出上限，默认 `4096` |
| `TOMATO_KB_MANIFEST_MAX_CHARS` | 可选，维护时笔记摘录总字数上限，默认 `28000` |
| `TOMATO_KB_NOTE_NAME_MAX_LEN` | 可选，由知识点标题生成的文件名主体最大字符数，默认 `72`，范围约 16–200 |

在 `backend/.env` 中配置（启动时已自动加载），例如 OpenRouter：

```bash
OPENROUTER_API_KEY=sk-or-v1-...
# OPENROUTER_MODEL=openai/gpt-4o-mini
```

然后：

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

详见 `backend/.env.example`。

### 2. 前端

新终端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 Vite 提示的地址（一般为 `http://127.0.0.1:5173`）。开发模式下 `/api` 会代理到 `http://127.0.0.1:8000`。

### 3. 试用

配置好 `OPENROUTER_API_KEY` 或 `OPENAI_API_KEY` 后，在页面选择手写笔记照片 → 自动处理 → 展示 **Markdown**，并**保存到本机知识库目录**；可在「个人知识库」卡片中**自定义根目录**（任意本机路径，包括仓库外），或触发「立即整理」以更新 `知识库索引.md`。未配置 Key 时任务会失败，页面顶部也会提示；无 Key 联调 UI 可设 `TOMATO_USE_STUB=1`。若 `.env` 里曾开过 `TOMATO_USE_STUB=1` 且已填入 Key，现在会**自动走真实识别**，无需再手动删（仍想用假数据可设 `TOMATO_FORCE_STUB=1`）。

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/jobs` | 创建任务，返回 `job_id` 与 `upload_path` |
| POST | `/api/jobs/{id}/upload` | `multipart/form-data`，字段名 `file` |
| POST | `/api/jobs/{id}/start` | 入队处理（当前为进程内 BackgroundTasks） |
| GET | `/api/jobs/{id}` | 查询状态；`done` 时含 `markdown`；`kb_note_relative` 为笔记在知识库内的相对路径 |
| GET | `/api/kb` | 知识库根目录、`root_source`（env / user_config / default）、是否可在线编辑等 |
| PUT | `/api/kb/root` | JSON `{"path":"/绝对路径"}` 保存自定义根目录（写入 `kb_root.json`）；若已设 `TOMATO_KB_DIR` 则拒绝 |
| DELETE | `/api/kb/root` | 删除 `kb_root.json`，恢复默认 `{data}/knowledge_base` |
| POST | `/api/kb/maintain` | 异步触发一次知识库整理（重写 `知识库索引.md`） |
