"use client";
// The whole dashboard: Shortlist (evaluate CVs + shortlisted candidates), Review queue
// (medium candidates + rejection emails) and Audit log.
import { useCallback, useEffect, useRef, useState } from "react";
import { useReveal, useEnter, useCountUp, usePulse } from "@/lib/motion";

// Job key -> title, filled from the server on every refresh (PM / SPM plus any new jobs).
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
  const [checked, setChecked] = useState(false); // first load attempted (avoids flashing the passcode form)
  const [needsPasscode, setNeedsPasscode] = useState(false); // only when the server answers 401
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("shortlist");
  const [busy, setBusy] = useState(null); // id of the candidate an action is running for

  const api = useCallback(
    (path, opts = {}) =>
      fetch(path, { ...opts, headers: { ...(opts.headers || {}), "x-passcode": pc.current } }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.status === 401) { setAuthed(false); setNeedsPasscode(true); throw new Error("Wrong passcode"); }
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      }),
    []
  );
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // Loads the dashboard. A temporary server error on first load is retried quietly
  // (with no passcode set the site should simply open); only a 401 asks for the passcode.
  const refresh = useCallback(async (retries = 0) => {
    try {
      let d;
      for (let attempt = 0; ; attempt++) {
        try { d = await api("/api/candidates"); break; }
        catch (e) {
          if (e.message === "Wrong passcode" || attempt >= retries) throw e;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      for (const j of d.jobs || []) ROLE_NAMES[j.key] = j.title;
      setData(d);
      setLoadError("");
      setAuthed(true);
      setNeedsPasscode(false);
      try { localStorage.setItem("kargo-passcode", pc.current); } catch {}
    } catch (e) {
      setLoadError(e.message);
    }
  }, [api]);

  // Try straight away: with no passcode set on the server this just opens the dashboard;
  // with one, a stored passcode is used, or the passcode form is shown.
  useEffect(() => {
    const p = getStored();
    if (p) { pc.current = p; setPasscode(p); }
    refresh(3).finally(() => setChecked(true));
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

  if (!authed && !needsPasscode) {
    return (
      <>
        <Header />
        <main>
          <div className="card row">
            {!checked ? <span className="muted">Loading…</span> : (<>
              <span className="error">Couldn't load the dashboard{loadError ? `: ${loadError}` : ""}.</span>
              <button className="primary" onClick={() => refresh(2)}>Retry</button>
            </>)}
          </div>
        </main>
      </>
    );
  }
  if (!authed) {
    return (
      <>
        <Header />
        <main>
          <form className="card row" onSubmit={(e) => { e.preventDefault(); refresh(); }}>
            <input type="password" placeholder="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
            <button className="primary">Open</button>
            {loadError && passcode && <span className="error">{loadError}</span>}
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
  return <Board {...{ tab, setTab, data, loadError, all, count, medium, rejections, rejectionsUnsent, actions, api, refresh, sendAllRejections }} />;
}

// Stat tiles double as filters: clicking one opens the Audit log showing just those candidates.
const FILTERS = {
  all: { label: "Evaluated", test: () => true },
  high: { label: "High", test: (c) => c.tier === "high" },
  medium: { label: "Medium", test: (c) => c.tier === "medium" },
  rejected: { label: "Auto-rejected", test: (c) => c.tier === "rejected" },
  invited: { label: "Invites sent", test: (c) => c.status === "sent" && c.sent_email_type === "invite" },
};

function Board({ tab, setTab, data, loadError, all, count, medium, rejections, rejectionsUnsent, actions, api, refresh, sendAllRejections }) {
  const [filter, setFilter] = useState("all");
  const [role, setRoleRaw] = useState("PM"); // job tab on the Shortlist page
  const jobs = data?.jobs?.length ? data.jobs : [{ key: "PM" }, { key: "SPM" }];
  const setRole = setRoleRaw;
  // If the selected job was deleted, fall back to the first one.
  useEffect(() => { if (!jobs.some((j) => j.key === role)) setRoleRaw(jobs[0].key); }, [jobs, role]);
  const mainRef = useReveal([tab, filter]);
  const openFiltered = (key) => { setFilter(key); setTab("audit"); };
  const goTab = (t) => { setFilter("all"); setTab(t); };
  const [newJobOpen, setNewJobOpen] = useState(false);
  const startNewJob = () => { setNewJobOpen(true); goTab("rubric"); };

  return (
    <>
      <Header tab={tab} setTab={goTab} reviewCount={medium.length + rejectionsUnsent.length} />
      {data?.missing?.length > 0 && (
        <div className="banner">Not configured on the server: {data.missing.join(", ")}{data.missing.includes("RESEND_API_KEY") && " (needed to send email)"}</div>
      )}
      <main ref={mainRef}>
        {loadError && <p className="error">{loadError}</p>}
        <div className="stats">
          {Object.entries(FILTERS).map(([key, f]) => (
            <Stat key={key} n={count(f.test)} label={f.label} active={tab === "audit" && filter === key} onClick={() => openFiltered(key)} />
          ))}
        </div>

        {tab === "shortlist" && (
          <>
            <div className="roletabs" data-anim>
              {jobs.map(({ key: r }) => (
                <button key={r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>
                  {ROLE_NAMES[r]} <span className="muted">{all.filter((c) => c.applied_role === r).length} CVs</span>
                </button>
              ))}
              <button className="addjob" onClick={startNewJob} title="Paste or upload a JD; the AI drafts a rubric for a new job">+ New job from a JD</button>
            </div>
            <Evaluate api={api} onDone={refresh} existing={all} role={role} />
            <Shortlist key={role} role={role} candidates={all.filter((c) => c.list === "shortlist" && c.applied_role === role)} actions={actions} testRecipient={data?.testRecipient} />
          </>
        )}
        {tab === "review" && (
          <>
            <MediumQueue candidates={medium} actions={actions} testRecipient={data?.testRecipient} thresholds={data?.thresholds} />
            <RejectionList thresholds={data?.thresholds} candidates={rejections} unsent={rejectionsUnsent.length} actions={actions} onSendAll={() => sendAllRejections(rejectionsUnsent.length)} />
          </>
        )}
        {tab === "howto" && <HowItWorks data={data} goTab={goTab} startNewJob={startNewJob} />}
        {tab === "rubric" && <JobsView data={data} api={api} refresh={refresh} newJobOpen={newJobOpen} setNewJobOpen={setNewJobOpen} />}
        {tab === "audit" && <AuditLog candidates={all} filter={filter} setFilter={setFilter} api={api} refresh={refresh} thresholds={data?.thresholds} />}
      </main>
    </>
  );
}

function Header({ tab, setTab, reviewCount }) {
  const ref = useEnter();
  const badge = usePulse(reviewCount);
  return (
    <header className="top" ref={ref}>
      <div
        className={`brand ${setTab ? "home" : ""}`}
        role={setTab ? "link" : undefined}
        tabIndex={setTab ? 0 : undefined}
        title={setTab ? "Home" : undefined}
        onClick={() => { if (setTab) { setTab("shortlist"); window.scrollTo({ top: 0, behavior: "smooth" }); } }}
        onKeyDown={(e) => { if (setTab && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setTab("shortlist"); window.scrollTo({ top: 0, behavior: "smooth" }); } }}
      >
        <div className="logo">K</div>
        <div>
          <div className="title">Kargo Hiring</div>
          <div className="tagline">Every CV scored on evidence. Every candidate hears back.</div>
        </div>
      </div>
      {setTab && (
        <nav className="tabs">
          <button className={tab === "howto" ? "on" : ""} onClick={() => setTab("howto")}>How this works</button>
          <button className={tab === "shortlist" ? "on" : ""} onClick={() => setTab("shortlist")}>Shortlist</button>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
            Review queue {reviewCount > 0 && <span className="badge" ref={badge}>{reviewCount}</span>}
          </button>
          <button className={tab === "rubric" ? "on" : ""} onClick={() => setTab("rubric")}>Jobs &amp; rubrics</button>
          <button className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>Audit log</button>
        </nav>
      )}
    </header>
  );
}

function Stat({ n, label, active, onClick }) {
  const num = useCountUp(n);
  return (
    <button type="button" className={`stat ${active ? "on" : ""}`} data-anim onClick={onClick} title={`Show ${label.toLowerCase()} candidates`}>
      <div className="n" ref={num}>{n}</div>
      <div className="label">{label} <span className="go">→</span></div>
    </button>
  );
}

// --- Evaluate CVs: role, files, optional single-CV override, parallel queue ---

function Evaluate({ api, onDone, existing, role }) {
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const addPicked = (list) => {
    const ok = [...list].filter((f) => /\.(pdf|docx|txt|md)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.name === f.name))]);
  };
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
    <section
      className={`card dropcard ${dragging ? "over" : ""}`} data-anim
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addPicked(e.dataTransfer.files); }}
    >
      <h2>Evaluate {ROLE_NAMES[role]} CVs <span className="muted small">choose or drop as many as you like, then click Evaluate</span></h2>
      <div className="evalgrid">
        <label className="field grow">CV files for {ROLE_NAMES[role]} (PDF, Word or .txt, multiple allowed)
          <input key={inputKey} type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => { addPicked(e.target.files); setInputKey((k) => k + 1); }} />
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
        {files.length > 0 && (
          <span className="muted">
            {files.length} CV{files.length === 1 ? "" : "s"} ready: {files.slice(0, 3).map((f) => f.name).join(", ")}{files.length > 3 && ` +${files.length - 3} more`}
            {" "}<button className="link" onClick={() => setFiles([])}>clear</button>
          </span>
        )}
        <button className="primary" onClick={evaluate} disabled={!files.length}>{files.length > 1 ? `Evaluate ${files.length} CVs` : "Evaluate"}</button>
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

function Shortlist({ role, candidates, actions, testRecipient }) {
  const [min, setMin] = useState(0);
  const shown = candidates.filter((c) => c.match >= min);
  return (
    <section>
      <h2 className="section" data-anim>{ROLE_NAMES[role]} shortlist <span className="muted small">High potential, plus medium candidates you reconsider</span></h2>
      <MinMatch value={min} onChange={setMin} shown={shown.length} />
      {shown.length === 0 && <div className="card muted">No shortlisted {ROLE_NAMES[role]} candidates yet. Evaluate some CVs above.</div>}
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
  const ref = useEnter();
  return (
    <article className={`card cand ${c.tier}`} ref={ref}>
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
          <p className="muted small">Match by job: {Object.entries(c.job_scores || {}).filter(([, v]) => v != null).map(([k, v]) => `${ROLE_NAMES[k] || k} ${v}%`).join(" · ")}</p>
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

function MediumQueue({ candidates, actions, testRecipient, thresholds }) {
  const [open, setOpen] = useState(true);
  const [why, setWhy] = useState(null);
  const [min, setMin] = useState(0);
  const [detail, setDetail] = useState(null);
  const shown = candidates.filter((c) => c.match >= min);
  return (
    <section className="card" data-anim>
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
            <div key={c.id} className="qrow" data-anim>
              <div className="grow clickable" onClick={() => setWhy(c)} title="Why this category?">
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
      {why && <WhyModal c={why} t={thresholds || {}} onClose={() => setWhy(null)} />}
    </section>
  );
}

function RejectionList({ candidates, unsent, actions, onSendAll, thresholds }) {
  const [open, setOpen] = useState(true);
  const [why, setWhy] = useState(null);
  return (
    <section className="card" data-anim>
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
        <div key={c.id} className="qrow" data-anim>
          <div className="grow clickable" onClick={() => setWhy(c)} title="Why this category?">
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
      {why && <WhyModal c={why} t={thresholds || {}} onClose={() => setWhy(null)} />}
    </section>
  );
}

// --- Audit log ------------------------------------------------------------------

function AuditLog({ candidates: all, filter, setFilter, api, refresh, thresholds }) {
  const [why, setWhy] = useState(null); // candidate whose tier explanation is open
  const [wiping, setWiping] = useState(false);
  async function deleteAllCvs() {
    const typed = prompt(`This deletes all ${all.length} CVs: candidates, their personal details, scores, briefs and email drafts.\nJobs, JDs and rubrics are kept.\n\nType DELETE to confirm.`);
    if (typed !== "DELETE") return;
    setWiping(true);
    try {
      const r = await api("/api/candidates/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
      alert(`${r.deleted} CVs deleted. Jobs and rubrics are unchanged.`);
    } catch (e) { alert(e.message); }
    setWiping(false);
    refresh();
  }
  const candidates = all.filter(FILTERS[filter].test);
  const status = (c) =>
    c.status === "sent" ? (c.sent_email_type === "invite" ? "Invite sent" : "Rejection scheduled")
      : c.decision === "passed" ? "Passed" : c.decision === "reconsidered" ? "Reconsidered" : "Awaiting decision";
  return (
    <section className="card" data-anim>
      <h2>Audit log</h2>
      <div className="muted small" style={{ marginBottom: 10 }}>Every evaluated candidate, including auto-rejected ones, with full scoring evidence and rationale.</div>
      <div className="chips filters">
        {Object.entries(FILTERS).map(([key, f]) => (
          <button key={key} className={`fchip ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>
            {f.label} <span className="muted">{all.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      {candidates.length === 0 && <div className="muted" style={{ padding: "10px 0" }}>No candidates in this group yet.</div>}
      <div className="tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Candidate</th><th>Role</th><th>Match</th><th>Risk</th><th>Category</th><th>Status</th><th>Email</th></tr></thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} data-anim className="clickrow" onClick={() => setWhy(c)} title="Why this category?">
                <td className="muted">{c.ref}</td>
                <td>{c.name}</td>
                <td>{ROLE_NAMES[c.applied_role] || c.applied_role}</td>
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
      {why && <WhyModal c={why} t={thresholds || {}} onClose={() => setWhy(null)} />}
      <div className="danger">
        <div>
          <b>Start again</b>
          <div className="muted small">Deletes every CV and everything generated from it. Jobs, JDs and rubrics are kept.</div>
        </div>
        <button className="dangerbtn" onClick={deleteAllCvs} disabled={wiping || !all.length}>{wiping ? "Deleting…" : `Delete all ${all.length} CVs`}</button>
      </div>
    </section>
  );
}

// --- Jobs & rubrics ---------------------------------------------------------------

function JobsView({ data, api, refresh, newJobOpen, setNewJobOpen }) {
  const criteria = data?.rubric || [];
  const jobs = data?.jobs || [];
  const t = data?.thresholds || {};
  return (
    <>
      <section className="card" data-anim>
        <h2>Jobs &amp; rubrics</h2>
        <div className="muted small">Every CV is scored against every job's rubric, 1-5 per criterion, with quoted evidence. Match % is the weighted score for the job it was uploaded to.</div>
        <div className="rules">
          <span><span className="pill high">High potential</span> match &ge; {t.high}% and risk &le; {t.maxRisk}</span>
          <span><span className="pill medium">Medium potential</span> match &ge; {t.medium}% and risk &le; {t.maxRisk}</span>
          <span><span className="pill rejected">Auto-rejected</span> below {t.medium}%, or risk above {t.maxRisk}</span>
        </div>
      </section>

      <NewJob api={api} refresh={refresh} open={newJobOpen} setOpen={setNewJobOpen} />

      <div className="cols">
        {jobs.map((j) => (
          <JobCard key={j.key} job={j} criteria={criteria.filter((c) => c.role === j.key)} candidates={data?.candidates || []} api={api} refresh={refresh} />
        ))}
      </div>

      <section className="card" data-anim>
        <h2>Risk flags</h2>
        <div className="muted small" style={{ marginBottom: 8 }}>Each flag adds 30 risk points (max 100). They apply to every job.</div>
        {(data?.riskFlags || []).map((f) => (
          <div key={f.name} className="crit"><span className="chip">{f.name}</span> <span className="muted small">{f.description}</span></div>
        ))}
      </section>
    </>
  );
}

function JobCard({ job, criteria, candidates, api, refresh }) {
  const [progress, setProgress] = useState(null); // { done, total, failed }
  const unscored = candidates.filter((c) => c.job_scores?.[job.key] == null);
  const filed = candidates.filter((c) => c.applied_role === job.key).length;

  async function scoreExisting() {
    const list = [...unscored];
    let done = 0, failed = 0;
    setProgress({ done, total: list.length, failed });
    const worker = async () => {
      for (let c; (c = list.shift()); ) {
        try {
          await api("/api/jobs/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: job.key, id: c.id }) });
        } catch { failed++; }
        done++;
        setProgress({ done, total: done + list.length, failed });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    refresh();
  }

  async function deleteJob() {
    if (!confirm(`Delete the job "${job.title}", its rubric, and the ${filed} CV${filed === 1 ? "" : "s"} uploaded to it?\nOther jobs and their CVs are not affected.`)) return;
    try {
      const r = await api("/api/jobs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: job.key }) });
      alert(`Deleted "${job.title}"${r.candidatesDeleted ? ` and ${r.candidatesDeleted} CVs` : ""}.`);
    } catch (e) { alert(e.message); }
    refresh();
  }

  const running = progress && progress.done < progress.total;
  return (
    <section className="card" data-anim>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{job.title}</h2>
        <span className={`tag ${job.preset ? "" : "new"}`}>{job.preset ? "Preset" : "From JD"}</span>
      </div>
      <div className="muted small" style={{ margin: "4px 0 12px" }}>{filed} CV{filed === 1 ? "" : "s"} uploaded to this job</div>
      {criteria.map((c) => (
        <div key={c.id} className="rubcrit">
          <div className="row between"><b>{c.position}. {c.name}</b><span className="weight">{c.weight}%</span></div>
          <div className="meter"><div style={{ width: `${Math.min(100, c.weight * 2.5)}%` }} /></div>
          <div className="muted small">{c.description}</div>
        </div>
      ))}
      <div className="muted small">Total: {criteria.reduce((a, c) => a + c.weight, 0)}%</div>
      {job.jd_text && (
        <details className="reasoning">
          <summary>Job description</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{job.jd_text}</p>
        </details>
      )}
      <div className="row end actionsrow">
        {progress && <span className="muted small">{running ? `Scoring ${progress.done}/${progress.total}…` : `Scored ${progress.done - progress.failed} CVs${progress.failed ? `, ${progress.failed} failed` : ""}`}</span>}
        {unscored.length > 0 && !running && (
          <button onClick={scoreExisting} title="Score CVs already in the system against this job's rubric">Score {unscored.length} existing CV{unscored.length === 1 ? "" : "s"}</button>
        )}
        {!job.preset && <button className="dangerbtn" onClick={deleteJob} disabled={running}>Delete job</button>}
      </div>
    </section>
  );
}

function NewJob({ api, refresh, open, setOpen }) {
  const formRef = useRef(null);
  useEffect(() => { if (open) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [open]);
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null); // { title, jd, criteria }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function generate() {
    setBusy("generate"); setError("");
    const form = new FormData();
    form.append("title", title);
    form.append("jd", jd);
    if (file) form.append("file", file);
    try { setDraft(await api("/api/jobs/draft", { method: "POST", body: form })); } catch (e) { setError(e.message); }
    setBusy("");
  }
  const edit = (i, field, value) => setDraft((d) => ({ ...d, criteria: d.criteria.map((c, k) => (k === i ? { ...c, [field]: field === "weight" ? Number(value) : value } : c)) }));
  const total = draft?.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 0;

  async function create() {
    setBusy("create"); setError("");
    try {
      await api("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draft.title, jd: draft.jd, criteria: draft.criteria }) });
      setDraft(null); setTitle(""); setJd(""); setFile(null); setOpen(false);
      refresh();
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  if (!open) {
    return (
      <div className="row end" data-anim style={{ marginBottom: 14 }}>
        <button className="primary" onClick={() => setOpen(true)}>+ New job from a JD</button>
      </div>
    );
  }
  return (
    <section className="card newjob" data-anim ref={formRef}>
      <div className="row between"><h2 style={{ margin: 0 }}>New job</h2><button onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button></div>
      <div className="muted small" style={{ margin: "4px 0 12px" }}>Paste or upload a job description. The AI drafts a rubric you can edit before creating the job. PM and SPM are not changed.</div>
      {!draft ? (
        <>
          <label className="field">Job title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data Analyst" /></label>
          <label className="field">Job description<textarea rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full JD here…" /></label>
          <label className="field">…or upload it (PDF, Word or .txt)<input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
          <div className="row end">
            {error && <span className="error">{error}</span>}
            <button className="primary" onClick={generate} disabled={!title.trim() || (!jd.trim() && !file) || !!busy}>{busy === "generate" ? "Drafting rubric…" : "Generate rubric"}</button>
          </div>
        </>
      ) : (
        <>
          <label className="field">Job title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          {draft.criteria.map((c, i) => (
            <div key={i} className="critedit">
              <div className="row">
                <input className="grow" value={c.name} onChange={(e) => edit(i, "name", e.target.value)} />
                <input className="w" type="number" min="1" max="100" value={c.weight} onChange={(e) => edit(i, "weight", e.target.value)} /> <span className="muted">%</span>
              </div>
              <textarea rows={3} value={c.description} onChange={(e) => edit(i, "description", e.target.value)} />
            </div>
          ))}
          <div className="row end">
            <span className={total === 100 ? "muted" : "error"}>Weights total {total}%{total !== 100 && " (must be 100%)"}</span>
            {error && <span className="error">{error}</span>}
            <button onClick={generate} disabled={!!busy}>{busy === "generate" ? "Redrafting…" : "Regenerate"}</button>
            <button className="primary" onClick={create} disabled={total !== 100 || !draft.title.trim() || !!busy}>{busy === "create" ? "Creating…" : "Create job"}</button>
          </div>
        </>
      )}
    </section>
  );
}

// --- "Why is this candidate High / Medium / Auto-rejected?" -------------------------
// Built entirely from data already stored for the candidate: no AI call.

const pts = (n) => { const v = Math.round(n * 10) / 10; return `${v} point${v === 1 ? "" : "s"}`; };

function whyReasons(c, t) {
  const out = [];
  const flags = c.eval?.risk_flags || [];
  if (c.tier === "high") {
    out.push(`Match is ${c.match}%, at or above the ${t.high}% High-potential line.`);
    out.push(`Risk is ${c.risk}, within the limit of ${t.maxRisk}.`);
  } else if (c.tier === "medium") {
    out.push(`Match is ${c.match}%: above the ${t.medium}% Medium line but below the ${t.high}% needed for High (${pts(t.high - c.match)} short).`);
    out.push(`Risk is ${c.risk}, within the limit of ${t.maxRisk}.`);
  } else {
    if (c.risk > t.maxRisk) out.push(`Risk is ${c.risk}, above the limit of ${t.maxRisk}, so they are auto-rejected whatever the match.`);
    if (c.match < t.medium) out.push(`Match is ${c.match}%, below the ${t.medium}% needed for Medium (${pts(t.medium - c.match)} short).`);
  }
  if (flags.length) out.push(`Risk flags (30 points each): ${flags.join(", ")}.`);
  if (c.decision === "passed") out.push("You passed on this candidate, so they are on the rejection list.");
  if (c.decision === "reconsidered") out.push("You reconsidered this candidate, so they are on the Shortlist.");
  return out;
}

function WhyModal({ c, t, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rubric = [...(c.rubric || [])].filter((k) => k.score != null);
  const sorted = [...rubric].sort((a, b) => b.score - a.score);
  const strongest = sorted.slice(0, 2).filter((k) => k.score >= 3);
  const weakest = [...sorted].reverse().slice(0, 2).filter((k) => k.score <= 3);
  return (
    <div className="modalback" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <div>
            <div className="cname">{c.name}</div>
            <div className="muted small">{c.ref} · {ROLE_NAMES[c.applied_role] || c.applied_role}</div>
          </div>
          <div className="row nowrap">
            <Pill tier={c.tier} />
            <button onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <h3>Why {TIER_LABEL[c.tier]}</h3>
        <ul>{whyReasons(c, t).map((r, i) => <li key={i}>{r}</li>)}</ul>
        {c.eval?.summary && <p className="muted">{c.eval.summary}</p>}

        {strongest.length > 0 && (<>
          <h3>Strongest evidence</h3>
          {strongest.map((k) => <div key={k.name} className="crit"><b>{k.score}/5</b> {k.name} ({k.weight}%)<div className="muted small">{k.evidence}</div></div>)}
        </>)}
        {weakest.length > 0 && (<>
          <h3>What held them back</h3>
          {weakest.map((k) => <div key={k.name} className="crit"><b>{k.score}/5</b> {k.name} ({k.weight}%)<div className="muted small">{k.evidence}</div></div>)}
        </>)}
        {c.eval?.risks?.length > 0 && (<>
          <h3>Risks to verify</h3>
          <ul>{c.eval.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </>)}

        <h3>All scores</h3>
        {rubric.map((k) => (
          <div key={k.name} className="row between small"><span>{k.name} ({k.weight}%)</span><b>{k.score}/5</b></div>
        ))}
      </div>
    </div>
  );
}

// --- How this works ------------------------------------------------------------------
// Static explainer; reads the live thresholds and job list so the numbers stay true.

function HowItWorks({ data, goTab, startNewJob }) {
  const t = data?.thresholds || { high: 80, medium: 70, maxRisk: 30 };
  const jobs = data?.jobs || [];
  const steps = [
    { n: 1, title: "Pick a job and drop in CVs", body: "On the Shortlist page, choose the job tab (Product Manager, Senior Product Manager, or any job you add) and drop in as many PDF, Word or .txt CVs as you like. Three are evaluated at a time, about 10 seconds each." },
    { n: 2, title: "Personal details are removed first", body: "Before anything reaches the AI, plain code strips the name, email, phone and LinkedIn/GitHub links and stores them separately. The AI only ever sees the anonymised CV text and the rubric." },
    { n: 3, title: "Scored against every job's rubric", body: "Gemini scores each criterion 1 to 5 and quotes the CV line behind every score. Weighted together, that gives a match % for each job. Risk flags (for example \"No shipped outcomes\") add 30 risk points each." },
    { n: 4, title: "Sorted into High, Medium or Auto-rejected", body: `High potential: match ≥ ${t.high}% and risk ≤ ${t.maxRisk}. Medium: match ≥ ${t.medium}% and risk ≤ ${t.maxRisk}. Everyone else is auto-rejected. Click any candidate in the Review queue or Audit log to see exactly why.` },
    { n: 5, title: "Brief and emails are drafted", body: "Every candidate gets a summary, an interview brief, strengths, risks, three interview questions, and both an invite and a warm rejection, written from their own CV." },
    { n: 6, title: "You decide; nothing sends by itself", body: "Reconsider or Pass on anyone, edit the invite, and click Send. Rejections are scheduled to arrive 48 hours later, one at a time or all at once. Every candidate hears back." },
  ];
  return (
    <>
      <section className="card howhero" data-anim>
        <h2>How this works</h2>
        <p className="muted">Drop in CVs for a job. Each one is anonymised, scored on evidence against that job's rubric, sorted into a tier with the reasons shown, and given ready-to-send emails. You make every decision.</p>
        <h3>Full walkthrough · 3 min</h3>
        <video className="demo" src="/kargo-hiring-walkthrough.mp4" poster="/kargo-hiring-walkthrough.jpg" controls playsInline preload="metadata">
          Your browser can't play this video. <a href="/kargo-hiring-walkthrough.mp4">Download it</a>.
        </video>
        <div className="muted small">Every feature in order: upload, privacy, evidence-based scoring, the brief, tiers and their reasons, decisions, invites, and creating a new job from a JD.</div>
        <details className="reasoning" style={{ marginTop: 12 }}>
          <summary>Quick look · 22 seconds</summary>
          <video className="demo" src="/kargo-hiring-demo.mp4" poster="/kargo-hiring-demo.jpg" controls playsInline preload="none">
            Your browser can't play this video. <a href="/kargo-hiring-demo.mp4">Download it</a>.
          </video>
        </details>
      </section>
      <div className="steps">
        {steps.map((s) => (
          <section key={s.n} className="card step" data-anim>
            <div className="stepn">{s.n}</div>
            <div><b>{s.title}</b><div className="muted small" style={{ marginTop: 4 }}>{s.body}</div></div>
          </section>
        ))}
      </div>
      <section className="card" data-anim>
        <h2>Hiring for a different role?</h2>
        <p className="muted small">Paste or upload its job description. The AI drafts a 4 to 6 criterion rubric from it, you edit the criteria and weights, and the job gets its own tab with the same process: upload, anonymise, score, tier, brief, emails. Current jobs: {jobs.map((j) => j.title).join(", ") || "Product Manager, Senior Product Manager"}.</p>
        <div className="row end">
          <button onClick={() => goTab("rubric")}>See the rubrics</button>
          <button className="primary" onClick={startNewJob}>+ New job from a JD</button>
        </div>
      </section>
      <section className="card" data-anim>
        <h2>Starting again</h2>
        <p className="muted small">Audit log → "Start again" deletes every CV and everything generated from it (type DELETE to confirm). Jobs, JDs and rubrics are kept.</p>
        <div className="row end"><button className="primary" onClick={() => goTab("shortlist")}>Go to Shortlist</button></div>
      </section>
    </>
  );
}
