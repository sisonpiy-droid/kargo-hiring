"use client";
// The whole dashboard: upload, ranking, breakdown, brief, email draft, send.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };
// Each CV is ~8s of Gemini time; 3 in flight is ~3x faster without tripping
// rate limits (429s are retried server-side).
const CONCURRENCY = 3;

function getStored() {
  try { return localStorage.getItem("kargo-passcode") || ""; } catch { return ""; }
}

export default function Dashboard() {
  const [passcode, setPasscode] = useState("");
  const pc = useRef(""); // what API calls use; kept in sync with the input
  pc.current = passcode;
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [role, setRole] = useState("PM");        // role for uploads
  const [rankBy, setRankBy] = useState("PM");    // role the table is ranked by
  const [applied, setApplied] = useState("ALL"); // filter by applied role
  const [show, setShow] = useState("ALL");       // ALL | UNSENT | SENT
  const [openId, setOpenId] = useState(null);
  const [dragging, setDragging] = useState(false);

  // Upload queue. Items are mutated in place and `rerender` repaints; simpler than
  // immutable updates for a list whose items change state several times each.
  const queue = useRef([]); // [{ key, file, role, state: waiting|scoring|done|failed|skipped, msg }]
  const active = useRef(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const refreshTimer = useRef(null);

  const api = useCallback(
    (path, opts = {}) =>
      fetch(path, { ...opts, headers: { ...(opts.headers || {}), "x-passcode": pc.current } }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.status === 401) { setAuthed(false); throw new Error("Wrong passcode"); }
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      }),
    []
  );

  const refresh = useCallback(async () => {
    try {
      setData(await api("/api/candidates"));
      setLoadError("");
      setAuthed(true);
      try { localStorage.setItem("kargo-passcode", pc.current); } catch {}
    } catch (e) {
      setLoadError(e.message);
    }
  }, [api]);

  useEffect(() => {
    const p = getStored();
    if (p) { pc.current = p; setPasscode(p); refresh(); }
  }, [refresh]);

  // While a batch runs, refresh the table at most every 1.5s.
  function refreshSoon() {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 1500);
  }

  function pump() {
    while (active.current < CONCURRENCY) {
      const item = queue.current.find((i) => i.state === "waiting");
      if (!item) break;
      item.state = "scoring";
      active.current++;
      runItem(item).finally(() => { active.current--; refreshSoon(); pump(); });
    }
    rerender();
  }

  async function runItem(item) {
    const form = new FormData();
    form.append("file", item.file);
    form.append("role", item.role);
    try {
      const r = await api("/api/upload", { method: "POST", body: form });
      const warn = !r.email_found ? " · no email found in CV" : !r.name_found ? " · no name found in CV" : "";
      item.state = "done";
      item.msg = `PM ${r.pm_score} · SPM ${r.spm_score}${warn}`;
    } catch (e) {
      item.state = "failed";
      item.msg = e.message;
    }
  }

  function addFiles(files) {
    // Skip anything already uploaded or queued under the same file name + role,
    // so dropping the whole folder again is safe.
    const seen = new Set((data?.candidates || []).map((c) => `${c.file_name}|${c.applied_role}`));
    for (const i of queue.current) if (i.state !== "failed") seen.add(`${i.file.name}|${i.role}`);
    for (const file of files) {
      const id = `${file.name}|${role}`;
      const dup = seen.has(id);
      seen.add(id);
      queue.current.push({ key: `${id}|${queue.current.length}`, file, role, state: dup ? "skipped" : "waiting", msg: dup ? "already uploaded" : "" });
    }
    pump();
  }

  function retryFailed() {
    for (const i of queue.current) if (i.state === "failed") { i.state = "waiting"; i.msg = ""; }
    pump();
  }

  function clearFinished() {
    queue.current = queue.current.filter((i) => i.state === "waiting" || i.state === "scoring");
    rerender();
  }

  async function send(c, type) {
    const to = c.email || "(no email)";
    if (!confirm(`Send the ${type === "invite" ? "INTERVIEW INVITE" : "REJECTION"} to ${c.name} <${to}>?`)) return;
    try {
      await api("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, type }) });
    } catch (e) {
      alert(`Not sent: ${e.message}`);
    }
    refresh();
  }

  if (!authed) {
    return (
      <main>
        <h1>Kargo Hiring</h1>
        <form className="card row" onSubmit={(e) => { e.preventDefault(); refresh(); }}>
          <input type="password" placeholder="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
          <button className="primary">Open</button>
          {loadError && <span className="error">{loadError}</span>}
        </form>
      </main>
    );
  }

  const key = rankBy === "PM" ? "pm_score" : "spm_score";
  const all = data?.candidates || [];
  const rows = all
    .filter((c) => applied === "ALL" || c.applied_role === applied)
    .filter((c) => show === "ALL" || (show === "SENT") === (c.status === "sent"))
    .sort((a, b) => b[key] - a[key]);

  const q = queue.current;
  const count = (state) => q.filter((i) => i.state === state).length;
  const counts = { done: count("done"), scoring: count("scoring"), waiting: count("waiting"), failed: count("failed"), skipped: count("skipped") };
  const processed = counts.done + counts.failed + counts.skipped;

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Kargo Hiring</h1>
        <span className="muted">
          {all.length} candidates · {all.filter((c) => c.recommendation === "invite").length} recommended for interview · {all.filter((c) => c.status === "sent").length} sent
        </span>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Upload CVs</strong>
          <label>Applied for{" "}
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="PM">Product Manager (PM)</option>
              <option value="SPM">Senior Product Manager (SPM)</option>
            </select>
          </label>
          <span className="muted">Name, email and phone are removed before any AI step.</span>
        </div>

        <label
          className={`drop ${dragging ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <strong>Drop CVs here</strong> or click to choose. Pick as many as you like (Ctrl+A selects a whole folder).
          <div className="muted">PDF, DOCX or TXT · added as {ROLE_NAMES[role]} · you can keep adding while others process</div>
        </label>

        {q.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="row">
              <div className="bar"><div style={{ width: `${(processed / q.length) * 100}%` }} /></div>
              <span>
                {processed}/{q.length} · <b>{counts.done}</b> done
                {counts.scoring > 0 && <> · {counts.scoring} scoring</>}
                {counts.waiting > 0 && <> · {counts.waiting} waiting</>}
                {counts.skipped > 0 && <> · {counts.skipped} skipped</>}
                {counts.failed > 0 && <span className="error"> · {counts.failed} failed</span>}
              </span>
              {counts.failed > 0 && <button onClick={retryFailed}>Retry failed</button>}
              {processed > 0 && <button onClick={clearFinished}>Clear finished</button>}
            </div>
            <div className="queue">
              {q.map((i) => (
                <div key={i.key} className={i.state === "failed" ? "error" : i.state === "done" ? "" : "muted"}>
                  <span className={`dot ${i.state}`} /> {i.file.name} <span className="muted">({i.role})</span>: {i.state === "scoring" ? "scoring…" : i.state}{i.msg && ` · ${i.msg}`}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Candidates ({rows.length})</strong>
          <span className="muted">Rank by</span>
          <span className="seg">
            {["PM", "SPM"].map((r) => <button key={r} className={rankBy === r ? "on" : ""} onClick={() => setRankBy(r)}>{r} score</button>)}
          </span>
          <span className="muted">Applied for</span>
          <select value={applied} onChange={(e) => setApplied(e.target.value)}>
            <option value="ALL">All</option><option value="PM">PM</option><option value="SPM">SPM</option>
          </select>
          <span className="seg">
            {[["ALL", "All"], ["UNSENT", "Not sent"], ["SENT", "Sent"]].map(([v, l]) => (
              <button key={v} className={show === v ? "on" : ""} onClick={() => setShow(v)}>{l}</button>
            ))}
          </span>
          <button onClick={refresh}>Refresh</button>
        </div>
        {data && <p className="muted" style={{ margin: "0 0 8px" }}>Interview line: top {data.topN} applicants per role scoring ≥ {data.threshold}/100. Click a row for the brief, breakdown and email.</p>}
        {loadError && <p className="error">{loadError}</p>}

        {rows.length === 0 ? <p className="muted">{all.length ? "No candidates match these filters." : "No candidates yet. Upload CVs above."}</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Candidate</th><th>Applied</th><th>PM</th><th>SPM</th><th>Recommendation</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <Fragment key={c.id}>
                    <tr className={`cand ${openId === c.id ? "open" : ""}`} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                      <td>{i + 1}</td>
                      <td>{c.name}<div className="muted">{c.file_name}</div></td>
                      <td>{c.applied_role} <span className="muted">(#{c.rank_in_applied_role})</span></td>
                      <td className="num">{c.pm_score}</td>
                      <td className="num">{c.spm_score}</td>
                      <td><span className={`pill ${c.recommendation}`}>{c.recommendation === "invite" ? "Interview" : "Reject"}</span></td>
                      <td>{c.status === "sent"
                        ? <span className="pill sent">Sent {c.sent_email_type}</span>
                        : <span className="muted">Not sent</span>}</td>
                    </tr>
                    {openId === c.id && (
                      <tr><td colSpan={7}><Detail c={c} onSend={send} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Detail({ c, onSend }) {
  const [type, setType] = useState(c.recommendation);
  const draft = type === "invite" ? c.invite_draft : c.rejection_draft;
  const sent = c.status === "sent";

  return (
    <div className="detail">
      <h3>Interview brief</h3>
      <p style={{ margin: 0 }}>{c.brief}</p>

      <div className="grid2">
        {["PM", "SPM"].map((role) => (
          <div key={role}>
            <h3>{ROLE_NAMES[role]}: {role === "PM" ? c.pm_score : c.spm_score}/100</h3>
            {c.breakdown[role].map((k) => (
              <div key={k.name} className="crit">
                <b>{k.score ?? "–"}/10</b> {k.name} <span className="muted">({k.weight}%)</span>
                <div className="muted">{k.reason}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h3>Email to {c.name} <span style={{ textTransform: "none" }}>&lt;{c.email || "no email found"}&gt;</span></h3>
      <div className="row">
        <span className="seg">
          <button className={type === "invite" ? "on" : ""} onClick={() => setType("invite")} disabled={sent}>Interview invite</button>
          <button className={type === "rejection" ? "on" : ""} onClick={() => setType("rejection")} disabled={sent}>Rejection</button>
        </span>
        {type !== c.recommendation && !sent && <span className="muted">Overriding the recommendation ({c.recommendation})</span>}
      </div>
      <pre className="email">{sent ? (c.sent_email_type === "invite" ? c.invite_draft : c.rejection_draft) : draft}</pre>
      {sent
        ? <span className="pill sent">Sent {c.sent_email_type} on {new Date(c.sent_at).toLocaleString()}</span>
        : <button className="primary" onClick={() => onSend(c, type)} disabled={!c.email}>Send {type === "invite" ? "invite" : "rejection"}</button>}
    </div>
  );
}
