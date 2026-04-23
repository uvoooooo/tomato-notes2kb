import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/strings";

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

const STATUS_KEYS: Record<string, MessageKey> = {
  pending: "statusPending",
  processing: "statusProcessing",
  done: "statusDone",
  failed: "statusFailed",
};

function statusLabel(status: string, t: (k: MessageKey) => string): string {
  const k = STATUS_KEYS[status];
  return k ? t(k) : status;
}

type VisionMode = "stub" | "openrouter" | "openai" | "unconfigured" | "unknown";

export function App() {
  const { t, locale, setLocale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode>("unknown");
  const [kb, setKb] = useState<KbDashboard | null>(null);
  const [kbMaintaining, setKbMaintaining] = useState(false);
  const [kbPathInput, setKbPathInput] = useState("");
  const [kbPathSaving, setKbPathSaving] = useState(false);
  const [kbPathMessage, setKbPathMessage] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [busyMode, setBusyMode] = useState<"photo" | "text" | null>(null);

  useEffect(() => {
    setKbPathMessage(null);
  }, [locale]);

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
    if (s === "env") return t("kbSourceEnv");
    if (s === "user_config") return t("kbSourceUser");
    return t("kbSourceDefault");
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
        setKbPathMessage(
          typeof data.detail === "string" ? data.detail : t("errSaveFailed", { status: r.status }),
        );
        return;
      }
      setKb(data as KbDashboard);
      setKbPathInput((data as KbDashboard).root);
      setKbPathMessage(t("kbSaveOk"));
    } catch {
      setKbPathMessage(t("errNetwork"));
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
        setKbPathMessage(
          typeof data.detail === "string" ? data.detail : t("errResetFailed", { status: r.status }),
        );
        return;
      }
      setKb(data as KbDashboard);
      setKbPathInput((data as KbDashboard).root);
      setKbPathMessage(t("kbResetOk"));
    } catch {
      setKbPathMessage(t("errNetwork"));
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
      setBusyMode("photo");
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

        setMessage(t("processingMsg"));
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
        setBusyMode(null);
      }
    },
    [poll, refreshKb, t],
  );

  const onTextSubmit = useCallback(async () => {
    const raw = textDraft.trim();
    if (!raw) return;
    setBusy(true);
    setBusyMode("text");
    setMessage(null);
    setJob(null);
    try {
      const c = await fetch("/api/jobs", { method: "POST" });
      if (!c.ok) throw new Error(`create job: ${c.status}`);
      const created: { job_id: string; text_path: string } = await c.json();

      const tx = await fetch(created.text_path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (!tx.ok) throw new Error(`text: ${tx.status}`);

      const s = await fetch(`/api/jobs/${created.job_id}/start`, { method: "POST" });
      if (!s.ok) throw new Error(`start: ${s.status}`);

      setMessage(t("processingMsg"));
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
      setBusyMode(null);
    }
  }, [poll, refreshKb, t, textDraft]);

  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";

  return (
    <div className="app layout">
      <header className="site-header reveal">
        <div className="site-header__row">
          <div className="site-header__brand">
            <div className="site-header__mark" aria-hidden>
              🍅
            </div>
            <h1>{t("appTitle")}</h1>
          </div>
          <div className="lang-switch" role="group" aria-label={t("langAria")}>
            <button
              type="button"
              className={`lang-switch__btn${locale === "zh" ? " lang-switch__btn--active" : ""}`}
              onClick={() => setLocale("zh")}
              aria-pressed={locale === "zh"}
            >
              {t("langZh")}
            </button>
            <button
              type="button"
              className={`lang-switch__btn${locale === "en" ? " lang-switch__btn--active" : ""}`}
              onClick={() => setLocale("en")}
              aria-pressed={locale === "en"}
            >
              {t("langEn")}
            </button>
          </div>
        </div>
        <p className="site-header__lede">{t("tagline")}</p>
      </header>

      {visionMode === "unconfigured" ? (
        <div className="alert alert--warn reveal reveal--2" role="status">
          {t("warnUnconfigured")}
        </div>
      ) : null}
      {kb ? (
        <section className="panel panel--vault reveal reveal--2" aria-labelledby="kb-heading">
          <h2 id="kb-heading" className="panel-heading">
            {t("cardKbTitle")}
          </h2>
          <p className="kb-path">
            <span className="kb-path__label">{t("rootDir")}</span>
            <code className="kb-path__value">{kb.root}</code>
          </p>
          <p className="kb-meta">
            {t("kbMetaSourcePrefix")}
            <strong>{rootSourceLabel(kb.root_source)}</strong>
            {locale === "zh" ? "。" : ". "}
            {kb.root_editable_via_ui ? (
              <>{t("kbMetaCustomPath", { path: kb.kb_settings_file })}</>
            ) : (
              <>{t("kbMetaEnvLocked")}</>
            )}
          </p>
          <p className="kb-meta">
            {t("kbMetaNotesLocation", { notes: kb.notes_subdir, index: kb.index_file })}
          </p>
          {kb.root_editable_via_ui ? (
            <div className="kb-path-form">
              <label className="kb-path-form__label" htmlFor="kb-root-input">
                {t("kbPathLabel")}
              </label>
              <div className="kb-path-form__row">
                <input
                  id="kb-root-input"
                  type="text"
                  className="kb-path-form__input"
                  value={kbPathInput}
                  onChange={(e) => setKbPathInput(e.target.value)}
                  placeholder={t("placeholderVault")}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={kbPathSaving}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={kbPathSaving}
                  onClick={() => void onKbSavePath()}
                >
                  {kbPathSaving ? t("btnSaving") : t("btnSave")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={kbPathSaving}
                  onClick={() => void onKbResetPath()}
                >
                  {t("btnResetDefault")}
                </button>
              </div>
              {kbPathMessage ? <p className="kb-path-form__hint">{kbPathMessage}</p> : null}
            </div>
          ) : null}
          <div className="kb-stats">
            <span className="badge badge--neutral">{t("badgeNotesCount", { count: kb.note_count })}</span>
            {kb.last_maintenance_at ? (
              <span className="badge badge--neutral">
                {t("badgeLastMaintained")}{" "}
                {new Date(kb.last_maintenance_at).toLocaleString(dateLocale)}
                {kb.last_maintenance_mode ? ` · ${kb.last_maintenance_mode}` : ""}
              </span>
            ) : (
              <span className="badge badge--neutral">{t("badgeNoMaintenanceYet")}</span>
            )}
          </div>
          <div className="kb-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={kbMaintaining}
              onClick={() => void onKbMaintain()}
            >
              {kbMaintaining ? t("btnMaintaining") : t("btnMaintain")}
            </button>
          </div>
        </section>
      ) : null}

      {visionMode === "stub" ? (
        <div className="alert alert--warn reveal reveal--3" role="status">
          {t("warnStub")}
        </div>
      ) : null}

      <section className="card card--hero reveal reveal--3" aria-labelledby="add-content-heading">
        <h2 id="add-content-heading" className="section-heading">
          {t("addContentSection")}
        </h2>
        <div className="capture-grid">
          <div className="capture-cell">
            <h3 className="card__subtitle">{t("uploadPhotoSubtitle")}</h3>
            <div className="upload-row">
              <label className="upload-btn">
                <span className="upload-btn__icon" aria-hidden>
                  📷
                </span>
                {t("choosePhoto")}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
              </label>
              {busy && busyMode === "photo" ? (
                <div className="processing">
                  <span className="spinner" aria-hidden />
                  {t("processing")}
                </div>
              ) : !busy ? (
                <p className="hint">{t("hintPhoto")}</p>
              ) : null}
            </div>
          </div>
          <div className="capture-cell">
            <h3 className="card__subtitle">{t("textInputSubtitle")}</h3>
            <div className="text-input-block">
              <textarea
                className="text-input-block__area"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder={t("textPlaceholder")}
                rows={6}
                disabled={busy}
                spellCheck={true}
              />
              <div className="text-input-block__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || !textDraft.trim()}
                  onClick={() => void onTextSubmit()}
                >
                  {t("btnConvertText")}
                </button>
                {busy && busyMode === "text" ? (
                  <div className="processing processing--inline">
                    <span className="spinner" aria-hidden />
                    {t("processingText")}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {message ? <div className="inline-error">{message}</div> : null}
      </section>

      {job ? (
        <section className="card card--result reveal reveal--4" aria-labelledby="result-heading">
          <div className="result-head">
            <h2 id="result-heading" className="section-heading">
              {t("resultSection")}
            </h2>
          </div>
          <div className="badge-row">
            <span
              className={`badge ${job.status === "failed" ? "badge--fail" : job.status === "done" ? "badge--ok" : "badge--neutral"}`}
            >
              {statusLabel(job.status, t)}
            </span>
            <span className="badge badge--neutral">
              {t("taskId")} <code>{job.job_id.slice(0, 8)}…</code>
            </span>
          </div>
          {job.status === "failed" && job.error ? <div className="job-error">{job.error}</div> : null}
          {job.markdown ? (
            <>
              {job.kb_note_relative ? (
                <p className="kb-save-hint">{t("savedToKb", { path: job.kb_note_relative })}</p>
              ) : null}
              <MarkdownResult source={job.markdown} />
              <details className="markdown-details">
                <summary>{t("viewMarkdownSource")}</summary>
                <pre>{job.markdown}</pre>
              </details>
            </>
          ) : job.status === "done" ? (
            <p className="empty-hint">
              <span className="empty-hint__icon" aria-hidden>
                📭
              </span>
              {t("noMarkdown")}
            </p>
          ) : null}
        </section>
      ) : !busy ? (
        <section className="card card--result reveal reveal--4">
          <p className="empty-hint empty-hint--idle">
            <span className="empty-hint__icon" aria-hidden>
              📝
            </span>
            {t("emptyUpload")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
