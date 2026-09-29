"use client";
// The whole dashboard: Shortlist (evaluate CVs + shortlisted candidates), Review queue
// (medium candidates + rejection emails) and Audit log.
import { useCallback, useEffect, useRef, useState } from "react";

const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };
const TIER_LABEL = { high: "High potential", medium: "Medium potential", rejected: "Auto-rejected" };
const CONCURRENCY = 3; // CVs evaluated in parallel; each is ~10s of Gemini time

function getStored() {
  try { return localStorage.getItem("kargo-passcode") || ""; } catch { return ""; }
}

export default function Dashboard() {
  const [passcode, setPasscode] = useState("");
  const pc = useRef("");
  pc.current = passcode;
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("shortlist");
  const [busy, setBusy] = useState(null); // id of the candidate an action is running for

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
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

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

  async function run(id, fn) {
    setBusy(id);
    try { await fn(); } catch (e) { alert(e.message); }
    setBusy(null);
    refresh();
  }
  const decide = (c, decision) => run(c.id, () => post("/api/decide", { id: c.id, decision }));
  const sendInvite = (c, draft) => {
    if (!confirm(`Send the interview invite to ${c.name} <${data.testRecipient || draft.to}>?`)) return;
    run(c.id, () => post("/api/send", { id: c.id, type: "invite", ...draft }));
  };
  const sendRejection = (c) => {
    if (!confirm(`Schedule the rejection email to ${c.name}? It arrives 48 hours from now.`)) return;
    run(c.id, () => post("/api/send", { id: c.id, type: "rejection" }));
  };
  const sendAllRejections = (n) => {
    if (!confirm(`Schedule rejection emails for all ${n} candidates not yet emailed? Each arrives 48 hours from now.`)) return;
    run("all", async () => {
      const r = await post("/api/send-rejections", {});
      alert(`${r.sent} rejection email${r.sent === 1 ? "" : "s"} scheduled.${r.failed ? ` ${r.failed} failed: ${r.errors.join("; ")}` : ""}`);
    });
  };

  if (!authed) {
    return (
      <>
        <Header />
        <main>
          <form className="card row" onSubmit={(e) => { e.preventDefault(); refresh(); }}>
            <input type="password" placeholder="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
            <button className="primary">Open</button>
            {loadError && <span className="error">{loadError}</span>}
          </form>
        </main>
      </>
    );
  }

  const all = data?.candidates || [];
  const count = (f) => all.filter(f).length;
  const medium = all.filter((c) => c.list === "medium");
  const rejections = all.filter((c) => c.list === "rejection");
  const rejectionsUnsent = rejections.filter((c) => c.status !== "sent");
  const actions = { decide, sendInvite, sendRejection, busy };

  return (
    <>
      <Header tab={tab} setTab={setTab} reviewCount={medium.length + rejectionsUnsent.length} />
      {data?.missing?.length > 0 && (
        <div className="banner">Not configured on the server: {data.missing.join(", ")}{data.missing.includes("RESEND_API_KEY") && " (needed to send email)"}</div>
      )}
      <main>
        {loadError && <p className="error">{loadError}</p>}
        <div className="stats">
          <Stat n={all.length} label="Evaluated" />
          <Stat n={count((c) => c.tier === "high")} label="High" />
          <Stat n={count((c) => c.tier === "medium")} label="Medium" />
          <Stat n={count((c) => c.tier === "rejected")} label="Auto-rejected" />
          <Stat n={count((c) => c.status === "sent" && c.sent_email_type === "invite")} label="Invites sent" />
        </div>

        {tab === "shortlist" && (
          <>
            <Evaluate api={api} onDone={refresh} existing={all} />
            <Shortlist candidates={all.filter((c) => c.list === "shortlist")} actions={actions} testRecipient={data?.testRecipient} />
          </>
        )}
        {tab === "review" && (
          <>
            <MediumQueue candidates={medium} actions={actions} testRecipient={data?.testRecipient} />
            <RejectionList candidates={rejections} unsent={rejectionsUnsent.length} actions={actions} onSendAll={() => sendAllRejections(rejectionsUnsent.length)} />
          </>
        )}
        {tab === "audit" && <AuditLog candidates={all} />}
      </main>
    </>
  );
}

function Header({ tab, setTab, reviewCount }) {
  return (
    <header className="top">
      <div className="brand">
        <div className="logo">K</div>
        <div>
          <div className="title">Kargo Hiring</div>
          <div className="tagline">AI finds the signal. Arjun makes the decision. Automation handles everything after.</div>
        </div>
      </div>
      {setTab && (
        <nav className="tabs">
          <button className={tab === "shortlist" ? "on" : ""} onClick={() => setTab("shortlist")}>Shortlist</button>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
            Review queue {reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </button>
          <button className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>Audit log</button>
        </nav>
      )}
    </header>
  );
}

function Stat({ n, label }) {
  return <div className="stat"><div className="n">{n}</div><div className="label">{label}</div></div>;
}

// --- Evaluate CVs: role, files, optional single-CV override, parallel queue ---

function Evaluate({ api, onDone, existing }) {
  const [role, setRole] = useState("SPM");
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const queue = useRef([]);
  const active = useRef(0);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const refreshTimer = useRef(null);

  function refreshSoon() {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(onDone, 1500);
  }

  function pump() {
    while (active.current < CONCURRENCY) {
      const item = queue.current.find((i) => i.state === "waiting");
      if (!item) break;
      item.state = "evaluating";
      active.current++;
      runItem(item).finally(() => { active.current--; refreshSoon(); pump(); });
    }
    rerender();
  }

  async function runItem(item) {
    const form = new FormData();
    form.append("file", item.file);
    form.append("role", item.role);
    if (item.name) form.append("name", item.name);
    if (item.email) form.append("email", item.email);
    try {
      const r = await api("/api/upload", { method: "POST", body: form });
      item.state = "done";
      item.msg = `${TIER_LABEL[r.tier]} · ${r.match}% match · ${r.risk} risk${!r.email_found ? " · no email found" : ""}`;
    } catch (e) {
      item.state = "failed";
      item.msg = e.message;
    }
  }

  function evaluate() {
    // Skip files already evaluated (or queued) under the same name + role.
    const seen = new Set(existing.map((c) => `${c.file_name}|${c.applied_role}`));
    for (const i of queue.current) if (i.state !== "failed") seen.add(`${i.file.name}|${i.role}`);
    const single = files.length === 1;
    for (const file of files) {
      const id = `${file.name}|${role}`;
      const dup = seen.has(id);
      seen.add(id);
      queue.current.push({
        key: `${id}|${queue.current.length}`, file, role,
        name: single ? name.trim() : "", email: single ? email.trim() : "",
        state: dup ? "skipped" : "waiting", msg: dup ? "already evaluated" : "",
      });
    }
    setFiles([]); setName(""); setEmail(""); setInputKey((k) => k + 1);
    pump();
  }

  const q = queue.current;
  const n = (s) => q.filter((i) => i.state === s).length;
  const processed = n("done") + n("failed") + n("skipped");

  return (
    <section className="card">
      <h2>Evaluate CVs</h2>
      <div className="evalgrid">
        <label className="field">Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="SPM">Senior Product Manager</option>
            <option value="PM">Product Manager</option>
          </select>
        </label>
        <label className="field grow">CV files (PDF, Word or .txt, multiple allowed)
          <input key={inputKey} type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => setFiles([...e.target.files])} />
        </label>
      </div>
      <details className="override">
        <summary>Single CV: override name / email</summary>
        <div className="evalgrid">
          <label className="field grow">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to use the CV" /></label>
          <label className="field grow">Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Leave blank to use the CV" /></label>
        </div>
        <div className="muted small">Only applied when exactly one CV is selected.</div>
      </details>
      <div className="row end">
        {files.length > 0 && <span className="muted">{files.length} file{files.length === 1 ? "" : "s"} selected</span>}
        <button className="primary" onClick={evaluate} disabled={!files.length}>Evaluate</button>
      </div>

      {q.length > 0 && (
        <div className="queuebox">
          <div className="row">
            <div className="bar"><div style={{ width: `${(processed / q.length) * 100}%` }} /></div>
            <span className="muted">
              {processed}/{q.length} · {n("done")} done{n("evaluating") > 0 && ` · ${n("evaluating")} evaluating`}{n("waiting") > 0 && ` · ${n("waiting")} waiting`}{n("skipped") > 0 && ` · ${n("skipped")} skipped`}
              {n("failed") > 0 && <span className="error"> · {n("failed")} failed</span>}
            </span>
            {n("failed") > 0 && (
              <button onClick={() => { for (const i of q) if (i.state === "failed") { i.state = "waiting"; i.msg = ""; } pump(); }}>Retry failed</button>
            )}
            {processed > 0 && <button onClick={() => { queue.current = q.filter((i) => i.state === "waiting" || i.state === "evaluating"); rerender(); }}>Clear finished</button>}
          </div>
          <div className="queue">
            {q.map((i) => (
              <div key={i.key} className={i.state === "failed" ? "error" : "muted"}>
                <span className={`dot ${i.state}`} /> {i.file.name} ({i.role}): {i.state}{i.msg && ` · ${i.msg}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MinMatch({ value, onChange, shown }) {
  return (
    <div className="row minmatch">
      <span>Minimum match</span>
      <input type="range" min="0" max="100" step="5" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b>{value}%</b>
      <span className="muted">{shown} candidate{shown === 1 ? "" : "s"}</span>
    </div>
  );
}

// --- Shortlist ------------------------------------------------------------------

function Shortlist({ candidates, actions, testRecipient }) {
  const [min, setMin] = useState(0);
  const shown = candidates.filter((c) => c.match >= min);
  return (
    <section>
      <h2 className="section">Shortlist <span className="muted small">High potential, plus medium candidates you reconsider</span></h2>
      <MinMatch value={min} onChange={setMin} shown={shown.length} />
      {shown.length === 0 && <div className="card muted">No shortlisted candidates yet. Evaluate some CVs above.</div>}
      {shown.map((c) => <CandidateCard key={c.id} c={c} actions={actions} testRecipient={testRecipient} />)}
    </section>
  );
}

function Pill({ tier }) {
  return <span className={`pill ${tier}`}>{TIER_LABEL[tier]}</span>;
}

function CandidateCard({ c, actions, testRecipient, fromQueue }) {
  const e = c.eval;
  const sent = c.status === "sent";
  return (
    <article className={`card cand ${c.tier}`}>
      <div className="candhead">
        <div>
          <div className="cname">{c.name}</div>
          <div className="muted small">{c.ref} · {ROLE_NAMES[c.applied_role]}{c.decision === "reconsidered" && " · reconsidered"}</div>
        </div>
        <div className="row">
          <Pill tier={c.tier} />
          <div className="big"><b>{c.match}%</b><span>match</span></div>
          <div className="big"><b>{c.risk}</b><span>risk</span></div>
        </div>
      </div>
      {e.summary && <p>{e.summary}</p>}

      <div className="cols">
        <div>
          <h3>Rubric</h3>
          {c.rubric.map((k) => (
            <div key={k.name} className="crit">
              <div className="row between"><span>{k.name} ({k.weight}%)</span><b>{k.score ?? "–"}/5</b></div>
              <div className="meter"><div style={{ width: `${((k.score || 0) / 5) * 100}%` }} /></div>
              <div className="muted small">{k.evidence}</div>
            </div>
          ))}
          <h3>Risk flags</h3>
          {e.risk_flags?.length ? <div className="chips">{e.risk_flags.map((f) => <span key={f} className="chip">{f}</span>)}</div> : <div className="muted">None detected</div>}
        </div>
        <div>
          <h3>Interview brief</h3>
          {e.brief.map((p, i) => <p key={i}>{p}</p>)}
          <div className="subhead">Strengths</div>
          <ul>{e.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <div className="subhead">Risks</div>
          {e.risks.length ? <ul>{e.risks.map((s, i) => <li key={i}>{s}</li>)}</ul> : <div className="muted small">None flagged</div>}
          <div className="subhead">Probe in the interview</div>
          <ol>{e.probes.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      </div>

      {e.reasoning && (
        <details className="reasoning">
          <summary>Full evaluation reasoning</summary>
          <p>{e.reasoning}</p>
          <p className="muted small">Other role: PM {c.pm_score}% · SPM {c.spm_score}% match.</p>
        </details>
      )}

      {sent ? <SentNote c={c} /> : fromQueue ? (
        <div className="row end actionsrow">
          <button onClick={() => actions.sendRejection(c)} disabled={!!actions.busy}>Send rejection mail</button>
          <button className="primary" onClick={() => actions.decide(c, "reconsidered")} disabled={!!actions.busy}>Reconsider</button>
        </div>
      ) : (
        <InviteDraft c={c} actions={actions} testRecipient={testRecipient} />
      )}
    </article>
  );
}

function SentNote({ c }) {
  if (c.sent_email_type === "invite") return <div className="sentnote">Invite sent {new Date(c.sent_at).toLocaleString()}</div>;
  return <div className="sentnote">Rejection scheduled{c.scheduled_for ? ` for ${new Date(c.scheduled_for).toLocaleString()}` : ""}</div>;
}

function InviteDraft({ c, actions, testRecipient }) {
  const [to, setTo] = useState(c.email || "");
  const [subject, setSubject] = useState(c.invite_subject);
  const [body, setBody] = useState(c.invite_draft);
  const busy = actions.busy === c.id;
  return (
    <div className="draft">
      <h3>Invite draft <span className="tag">Draft</span></h3>
      <label className="field">To<input value={to} onChange={(e) => setTo(e.target.value)} /></label>
      {testRecipient && <div className="muted small">Test mode: every email goes to {testRecipient}.</div>}
      <label className="field">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field">Body<textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="row end">
        <button onClick={() => actions.decide(c, "passed")} disabled={!!actions.busy}>Pass</button>
        <button className="primary" onClick={() => actions.sendInvite(c, { to, subject, body })} disabled={!!actions.busy || (!to && !testRecipient)}>
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

// --- Review queue -----------------------------------------------------------------

function MediumQueue({ candidates, actions, testRecipient }) {
  const [open, setOpen] = useState(true);
  const [min, setMin] = useState(0);
  const [detail, setDetail] = useState(null);
  const shown = candidates.filter((c) => c.match >= min);
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>Medium potential <span className="muted">({candidates.length})</span></h2>
          <div className="muted small">Open the detailed summary, send a rejection mail, or reconsider to move them to the Shortlist.</div>
        </div>
        <button onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button>
      </div>
      {open && (
        <>
          <MinMatch value={min} onChange={setMin} shown={shown.length} />
          {shown.length === 0 && <div className="muted">Nobody here right now.</div>}
          {shown.map((c) => (
            <div key={c.id} className="qrow">
              <div className="grow">
                <div><b>{c.name}</b> <span className="muted small">{c.ref} · {ROLE_NAMES[c.applied_role]}</span> <Pill tier={c.tier} /> <span className="small"><b>{c.match}%</b> match · <b>{c.risk}</b> risk</span></div>
                <div className="clip">{c.eval.summary}</div>
              </div>
              <div className="row nowrap">
                <button onClick={() => setDetail(detail === c.id ? null : c.id)}>{detail === c.id ? "Hide summary" : "Open detailed summary"}</button>
                <button onClick={() => actions.sendRejection(c)} disabled={!!actions.busy}>Send rejection mail</button>
                <button className="primary" onClick={() => actions.decide(c, "reconsidered")} disabled={!!actions.busy}>Reconsider</button>
              </div>
              {detail === c.id && <div className="full"><CandidateCard c={c} actions={actions} testRecipient={testRecipient} fromQueue /></div>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function RejectionList({ candidates, unsent, actions, onSendAll }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>Rejection emails <span className="muted">({candidates.length} · {unsent} not sent)</span></h2>
          <div className="muted small">{unsent} not sent yet. Each arrives 48 hours after you send it.</div>
        </div>
        <div className="row">
          <button className="outline" onClick={onSendAll} disabled={!unsent || !!actions.busy}>{actions.busy === "all" ? "Scheduling…" : "Send all rejection mails"}</button>
          <button onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button>
        </div>
      </div>
      {open && candidates.map((c) => (
        <div key={c.id} className="qrow">
          <div className="grow">
            <div><b>{c.name}</b> <span className="muted small">{c.ref} · {ROLE_NAMES[c.applied_role]}</span> <Pill tier={c.decision === "passed" ? "rejected" : c.tier} /> <span className="small"><b>{c.match}%</b> match · <b>{c.risk}</b> risk</span>{c.decision === "passed" && <span className="muted small"> · passed by you</span>}</div>
            <div className="clip">{c.eval.summary}</div>
            {c.eval.risk_flags?.length > 0 && <div className="chips">{c.eval.risk_flags.map((f) => <span key={f} className="chip">{f}</span>)}</div>}
          </div>
          <div className="row nowrap">
            {c.status === "sent"
              ? <span className="status sent">{c.sent_email_type === "invite" ? "Invited" : "Scheduled"}</span>
              : <>
                  <span className="status">Not sent</span>
                  {c.decision === "passed" && <button onClick={() => actions.decide(c, null)} disabled={!!actions.busy}>Undo pass</button>}
                  <button className="primary" onClick={() => actions.sendRejection(c)} disabled={!!actions.busy}>Send rejection mail</button>
                </>}
          </div>
        </div>
      ))}
    </section>
  );
}

// --- Audit log ------------------------------------------------------------------

function AuditLog({ candidates }) {
  const status = (c) =>
    c.status === "sent" ? (c.sent_email_type === "invite" ? "Invite sent" : "Rejection scheduled")
      : c.decision === "passed" ? "Passed" : c.decision === "reconsidered" ? "Reconsidered" : "Awaiting decision";
  return (
    <section className="card">
      <h2>Audit log</h2>
      <div className="muted small" style={{ marginBottom: 10 }}>Every evaluated candidate, including auto-rejected ones, with full scoring evidence and rationale.</div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Candidate</th><th>Role</th><th>Match</th><th>Risk</th><th>Category</th><th>Status</th><th>Email</th></tr></thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id}>
                <td className="muted">{c.ref}</td>
                <td>{c.name}</td>
                <td>{c.applied_role}</td>
                <td><b>{c.match}%</b></td>
                <td>{c.risk}</td>
                <td><Pill tier={c.tier} /></td>
                <td>{status(c)}</td>
                <td className="muted">{c.email || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
