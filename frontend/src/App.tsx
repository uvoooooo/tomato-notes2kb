import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type JobResponse = {
  job_id: string;
  status: string;
  created_at: string;
  error: string | null;
  markdown: string | null;
  kb_note_relative?: string | null;
};

type KbRootSource = "env" | "user_config" | "default";

type KbDashboard = {
  root: string;
  notes_subdir: string;
  index_file: string;
  index_path: string;
  note_count: number;
  last_maintenance_at?: string | null;
  last_maintenance_mode?: string | null;
  root_source: KbRootSource;
  root_editable_via_ui: boolean;
  kb_settings_file: string;
};

function MarkdownResult({ source }: { source: string }) {
  return (
    <article className="markdown-result">
      <ReactMarkdown>{source}</ReactMarkdown>
    </article>
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "待处理",
    processing: "识别中",
    done: "完成",
    failed: "失败",
  };
  return map[status] ?? status;
}

type VisionMode = "stub" | "openrouter" | "openai" | "unconfigured" | "unknown";

export function App() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode>("unknown");
  const [kb, setKb] = useState<KbDashboard | null>(null);
  const [kbMaintaining, setKbMaintaining] = useState(false);
  const [kbPathInput, setKbPathInput] = useState("");
  const [kbPathSaving, setKbPathSaving] = useState(false);
  const [kbPathMessage, setKbPathMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/health");
        if (!r.ok) return;
        const h: { vision_mode?: string } = await r.json();
        const m = h.vision_mode;
        if (cancelled) return;
        if (m === "stub" || m === "openrouter" || m === "openai" || m === "unconfigured") setVisionMode(m);
        else setVisionMode("unknown");
      } catch {
        if (!cancelled) setVisionMode("unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshKb = useCallback(async () => {
    try {
      const r = await fetch("/api/kb");
      if (!r.ok) return;
      const j: KbDashboard = await r.json();
      setKb(j);
      setKbPathInput(j.root);
      setKbPathMessage(null);
    } catch {
      setKb(null);
    }
  }, []);

  useEffect(() => {
    void refreshKb();
  }, [refreshKb]);

  const rootSourceLabel = (s: KbRootSource): string => {
    if (s === "env") return "环境变量 TOMATO_KB_DIR";
    if (s === "user_config") return "已保存的自定义路径";
    return "默认目录（未单独配置）";
  };

  const onKbSavePath = async () => {
    if (!kb?.root_editable_via_ui) return;
    setKbPathSaving(true);
    setKbPathMessage(null);
    try {
      const r = await fetch("/api/kb/root", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: kbPathInput.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setKbPathMessage(typeof data.detail === "string" ? data.detail : `保存失败 (${r.status})`);
        return;
      }
      setKb(data as KbDashboard);
      setKbPathInput((data as KbDashboard).root);
      setKbPathMessage("已保存。新笔记将写入该目录（可与代码仓库完全分离）。");
    } catch {
      setKbPathMessage("网络错误");
    } finally {
      setKbPathSaving(false);
    }
  };

  const onKbResetPath = async () => {
    if (!kb?.root_editable_via_ui) return;
    setKbPathSaving(true);
    setKbPathMessage(null);
    try {
      const r = await fetch("/api/kb/root", { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setKbPathMessage(typeof data.detail === "string" ? data.detail : `恢复失败 (${r.status})`);
        return;
      }
      setKb(data as KbDashboard);
      setKbPathInput((data as KbDashboard).root);
      setKbPathMessage("已恢复为默认知识库目录。");
    } catch {
      setKbPathMessage("网络错误");
    } finally {
      setKbPathSaving(false);
    }
  };

  const onKbMaintain = async () => {
    setKbMaintaining(true);
    try {
      const r = await fetch("/api/kb/maintain", { method: "POST" });
      if (!r.ok) return;
      await new Promise((res) => setTimeout(res, 800));
      await refreshKb();
    } finally {
      setKbMaintaining(false);
    }
  };

  const poll = useCallback(async (jobId: string): Promise<JobResponse | null> => {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) throw new Error(`poll failed: ${r.status}`);
      const j: JobResponse = await r.json();
      setJob(j);
      if (j.status === "done" || j.status === "failed") return j;
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error("timeout waiting for job");
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setMessage(null);
      setJob(null);
      try {
        const c = await fetch("/api/jobs", { method: "POST" });
        if (!c.ok) throw new Error(`create job: ${c.status}`);
        const created: { job_id: string; upload_path: string } = await c.json();

        const fd = new FormData();
        fd.append("file", file);
        const u = await fetch(created.upload_path, { method: "POST", body: fd });
        if (!u.ok) throw new Error(`upload: ${u.status}`);

        const s = await fetch(`/api/jobs/${created.job_id}/start`, { method: "POST" });
        if (!s.ok) throw new Error(`start: ${s.status}`);

        setMessage("处理中…");
        const last = await poll(created.job_id);
        setMessage(null);
        if (last?.status === "failed" && last.error) {
          setMessage(last.error);
        }
        await refreshKb();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "unknown error");
      } finally {
        setBusy(false);
      }
    },
    [poll, refreshKb],
  );

  return (
    <>
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__logo" aria-hidden>
            🍅
          </div>
          <h1>Tomato Note Graph</h1>
        </div>
        <p className="app-header__tagline">
          上传手写笔记照片，由 LLM 转为 Markdown，并保存到本机<strong>个人知识库</strong>目录；后台定期整理索引。
        </p>
      </header>

      {visionMode === "unconfigured" ? (
        <div className="alert alert--warn" role="status">
          当前后端<strong>未配置识别服务</strong>：请在 <code>backend/.env</code> 中设置{" "}
          <code>OPENROUTER_API_KEY</code>（推荐）或 <code>OPENAI_API_KEY</code>，重启 API 后再上传。联调 UI 可设{" "}
          <code>TOMATO_USE_STUB=1</code>（固定假数据）。
        </div>
      ) : null}
      {kb ? (
        <section className="card card--kb" aria-labelledby="kb-heading">
          <h2 id="kb-heading" className="card__title">
            个人知识库（本机目录）
          </h2>
          <p className="kb-path">
            <span className="kb-path__label">根目录</span>
            <code className="kb-path__value">{kb.root}</code>
          </p>
          <p className="kb-meta">
            来源：<strong>{rootSourceLabel(kb.root_source)}</strong>。
            {kb.root_editable_via_ui ? (
              <>
                {" "}
                自定义路径保存在 <code className="kb-inline-code">{kb.kb_settings_file}</code>（在数据目录内，不包含笔记正文）。
              </>
            ) : (
              <> 当前由环境变量锁定，请在 <code>.env</code> 中修改 <code>TOMATO_KB_DIR</code> 并重启后端。</>
            )}
          </p>
          <p className="kb-meta">
            笔记文件位于 <code>{kb.notes_subdir}</code>；总览与整理见根目录{" "}
            <code>{kb.index_file}</code>（由维护任务自动生成）。
          </p>
          {kb.root_editable_via_ui ? (
            <div className="kb-path-form">
              <label className="kb-path-form__label" htmlFor="kb-root-input">
                知识库根目录（本机绝对路径，可指向仓库外任意文件夹）
              </label>
              <div className="kb-path-form__row">
                <input
                  id="kb-root-input"
                  type="text"
                  className="kb-path-form__input"
                  value={kbPathInput}
                  onChange={(e) => setKbPathInput(e.target.value)}
                  placeholder="/Users/you/Documents/MyVault"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={kbPathSaving}
                />
                <button type="button" className="btn-secondary" disabled={kbPathSaving} onClick={() => void onKbSavePath()}>
                  {kbPathSaving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={kbPathSaving}
                  onClick={() => void onKbResetPath()}
                >
                  恢复默认
                </button>
              </div>
              {kbPathMessage ? <p className="kb-path-form__hint">{kbPathMessage}</p> : null}
            </div>
          ) : null}
          <div className="kb-stats">
            <span className="badge badge--neutral">已存笔记 {kb.note_count} 条</span>
            {kb.last_maintenance_at ? (
              <span className="badge badge--neutral">
                最近整理 {new Date(kb.last_maintenance_at).toLocaleString()}
                {kb.last_maintenance_mode ? ` · ${kb.last_maintenance_mode}` : ""}
              </span>
            ) : (
              <span className="badge badge--neutral">尚未跑过整理</span>
            )}
          </div>
          <div className="kb-actions">
            <button type="button" className="btn-secondary" disabled={kbMaintaining} onClick={() => void onKbMaintain()}>
              {kbMaintaining ? "正在整理…" : "立即整理知识库"}
            </button>
          </div>
        </section>
      ) : null}

      {visionMode === "stub" ? (
        <div className="alert alert--warn" role="status">
          当前为占位模式（无 API Key 且 <code>TOMATO_USE_STUB=1</code>，或 <code>TOMATO_FORCE_STUB=1</code>
          ），结果为固定示例 Markdown。配置 Key 并重启后一般会变为真实识别。
        </div>
      ) : null}

      <section className="card card--hero" aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="card__title">
          上传笔记
        </h2>
        <div className="upload-row">
          <label className="upload-btn">
            <span className="upload-btn__icon" aria-hidden>
              📷
            </span>
            选择照片
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {busy ? (
            <div className="processing">
              <span className="spinner" aria-hidden />
              正在识别手写内容…
            </div>
          ) : (
            <p className="hint">
              支持常见图片格式，<strong>尽量拍平、光线均匀</strong>，字迹更清晰。
            </p>
          )}
        </div>
        {message ? <div className="inline-error">{message}</div> : null}
      </section>

      {job ? (
        <section className="card" aria-labelledby="result-heading">
          <h2 id="result-heading" className="card__title">
            识别结果
          </h2>
          <div className="badge-row">
            <span className={`badge ${job.status === "failed" ? "badge--fail" : job.status === "done" ? "badge--ok" : "badge--neutral"}`}>
              {statusLabel(job.status)}
            </span>
            <span className="badge badge--neutral">
              任务 ID <code>{job.job_id.slice(0, 8)}…</code>
            </span>
          </div>
          {job.status === "failed" && job.error ? <div className="job-error">{job.error}</div> : null}
          {job.markdown ? (
            <>
              {job.kb_note_relative ? (
                <p className="kb-save-hint">
                  已写入知识库：<code>{job.kb_note_relative}</code>（相对知识库根目录）
                </p>
              ) : null}
              <MarkdownResult source={job.markdown} />
              <details className="markdown-details">
                <summary>查看 Markdown 源码</summary>
                <pre>{job.markdown}</pre>
              </details>
            </>
          ) : job.status === "done" ? (
            <p className="empty-hint">
              <div className="empty-hint__icon" aria-hidden>
                📭
              </div>
              未返回 Markdown 内容
            </p>
          ) : null}
        </section>
      ) : !busy ? (
        <section className="card">
          <div className="empty-hint">
            <div className="empty-hint__icon">📝</div>
            上传一张照片开始
          </div>
        </section>
      ) : null}
    </>
  );
}
