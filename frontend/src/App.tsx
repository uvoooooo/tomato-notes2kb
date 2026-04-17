import { useCallback, useState } from "react";

type MindNode = { id: string; text: string; children: string[] };
type MindmapJson = { title: string; nodes: MindNode[] };

type JobResponse = {
  job_id: string;
  status: string;
  created_at: string;
  error: string | null;
  mindmap_json: MindmapJson | null;
};

function findRootId(nodes: MindNode[]): string | null {
  if (nodes.length === 0) return null;
  const childIds = new Set(nodes.flatMap((n) => n.children));
  const roots = nodes.filter((n) => !childIds.has(n.id));
  return roots[0]?.id ?? nodes[0].id;
}

function TreeBranch({
  id,
  byId,
}: {
  id: string;
  byId: Map<string, MindNode>;
}) {
  const node = byId.get(id);
  if (!node) return null;
  return (
    <li>
      {node.text}
      {node.children.length > 0 ? (
        <ul className="tree">
          {node.children.map((cid) => (
            <TreeBranch key={cid} id={cid} byId={byId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MindmapTree({ data }: { data: MindmapJson }) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const rootId = findRootId(data.nodes);
  if (!rootId) return <p>（空导图）</p>;
  return (
    <div>
      <div className="tree-title">{data.title}</div>
      <ul className="tree">
        <TreeBranch id={rootId} byId={byId} />
      </ul>
    </div>
  );
}

export function App() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);

  const poll = useCallback(async (jobId: string) => {
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

  const onFile = async (file: File | undefined) => {
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
      await poll(created.job_id);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Tomato Note Graph</h1>
      <div className="panel">
        <div className="row">
          <label className="file">
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            选择手写笔记图片
          </label>
          {busy ? <span className="status">请稍候…</span> : null}
        </div>
        {message ? <div className="error">{message}</div> : null}
      </div>

      {job ? (
        <div className="panel">
          <div className="status">
            任务 <code>{job.job_id}</code> — {job.status}
            {job.error ? ` — ${job.error}` : ""}
          </div>
          {job.mindmap_json ? (
            <>
              <MindmapTree data={job.mindmap_json} />
              <pre className="raw">{JSON.stringify(job.mindmap_json, null, 2)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
