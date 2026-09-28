"use client";
// The whole dashboard: upload, ranking, breakdown, brief, email draft, send.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };

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
  const [openId, setOpenId] = useState(null);
  const [uploads, setUploads] = useState([]);    // [{ name, state, msg }]

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

  async function uploadFiles(files) {
    const list = [...files].map((f) => ({ name: f.name, state: "waiting", msg: "" }));
    setUploads(list);
    // One at a time: each CV is two Gemini calls, and this keeps rate limits happy.
    for (let i = 0; i < files.length; i++) {
      list[i] = { ...list[i], state: "scoring…" };
      setUploads([...list]);
      const form = new FormData();
      form.append("file", files[i]);
      form.append("role", role);
      try {
        const r = await api("/api/upload", { method: "POST", body: form });
        const warn = !r.email_found ? " · no email found in CV" : !r.name_found ? " · no name found in CV" : "";
        list[i] = { ...list[i], state: "done", msg: `PM ${r.pm_score} · SPM ${r.spm_score}${warn}` };
      } catch (e) {
        list[i] = { ...list[i], state: "failed", msg: e.message };
      }
      setUploads([...list]);
      await refresh();
    }
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
  const rows = (data?.candidates || [])
    .filter((c) => applied === "ALL" || c.applied_role === applied)
    .sort((a, b) => b[key] - a[key]);
  const busy = uploads.some((u) => u.state === "scoring…" || u.state === "waiting");

  return (
    <main>
      <h1>Kargo Hiring</h1>

      <section className="card">
        <div className="row">
          <strong>Upload CVs</strong>
          <label>Applied for{" "}
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
              <option value="PM">Product Manager (PM)</option>
              <option value="SPM">Senior Product Manager (SPM)</option>
            </select>
          </label>
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" disabled={busy}
            onChange={(e) => { if (e.target.files.length) uploadFiles(e.target.files); e.target.value = ""; }} />
          <span className="muted">PDF, DOCX or TXT. Name, email and phone are removed before any AI step.</span>
        </div>
        {uploads.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {uploads.map((u, i) => (
              <div key={i} className={u.state === "failed" ? "error" : "muted"}>
                {u.name}: {u.state} {u.msg && `(${u.msg})`}
              </div>
            ))}
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
          <button onClick={refresh}>Refresh</button>
          {data && <span className="muted">Invite line: top {data.topN} per applied role scoring ≥ {data.threshold}</span>}
        </div>
        {loadError && <p className="error">{loadError}</p>}

        {rows.length === 0 ? <p className="muted">No candidates yet. Upload a CV above.</p> : (
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
