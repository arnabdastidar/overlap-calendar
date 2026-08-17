"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Member = { id: string; displayName: string; color: string; provider: string | null; calendarName: string | null; isDemo: boolean };
type GroupAccess = { groupName: string; slug: string; role: "admin" | "member"; participantId: string };
type Group = {
  groupName: string; slug: string; displayName: string; role: "admin" | "member";
  participantId: string; members: Member[]; accessibleGroups: GroupAccess[];
};
type Slot = { start: string; end: string };
type CalendarConfig = { google: boolean; microsoft: boolean; mcp: boolean; demo: boolean };
type Modal = "create" | "join" | "recover" | "creatorKey" | "switch" | "connect" | "share" | "settings" | "people" | null;

const durations = Array.from({ length: 10 }, (_, index) => (index + 1) * 30);

function Brand() {
  return <span className="brand"><span className="brand-mark"><i /><i /><i /></span><span>overlap</span></span>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
}

function jsonRequest(url: string, method: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (typeof window !== "undefined") {
    const activeGroup = new URLSearchParams(window.location.search).get("group");
    if (activeGroup) headers["x-overlap-group"] = activeGroup;
  }
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  });
}

export default function Home() {
  const [status, setStatus] = useState<"loading" | "welcome" | "group">("loading");
  const [group, setGroup] = useState<Group | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [duration, setDuration] = useState(60);
  const [days, setDays] = useState(30);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [source, setSource] = useState("none");
  const [finding, setFinding] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [toast, setToast] = useState("");
  const [formError, setFormError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [calendarConfig, setCalendarConfig] = useState<CalendarConfig>({ google: false, microsoft: false, mcp: false, demo: false });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadGroup = useCallback(async (slug?: string) => {
    try {
      const suffix = slug !== undefined ? `?group=${encodeURIComponent(slug)}` : "";
      const data = await jsonRequest(`/api/groups${suffix}`, "GET");
      setGroup(data.group);
      setStatus("group");
      return data.group as Group;
    } catch {
      setGroup(null);
      setStatus("welcome");
      return null;
    }
  }, []);

  const findTimes = useCallback(async (quiet = false) => {
    if (!group && status !== "group") return;
    const selectedGroup = new URLSearchParams(window.location.search).get("group");
    if (selectedGroup && group && selectedGroup !== group.slug) return;
    setFinding(true);
    try {
      const data = await jsonRequest(`/api/availability?duration=${duration}&days=${days}&timezone=${encodeURIComponent(timezone)}`, "GET");
      setSlots(data.slots);
      setSource(data.source);
      setSelected(data.slots[0] ?? null);
      if (!quiet && data.connectionCount) showToast(`Found ${data.slots.length} shared openings`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not find times.");
    } finally {
      setFinding(false);
    }
  }, [days, duration, group, showToast, status, timezone]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("connected");
      const calendarError = params.get("calendar_error");
      const requestedGroup = params.get("group") ?? undefined;
      if (connected) showToast(`${connected === "google" ? "Google" : "Microsoft"} Calendar connected`);
      if (calendarError) showToast(calendarError);
      if (connected || calendarError) {
        params.delete("connected");
        params.delete("calendar_error");
        window.history.replaceState({}, "", params.size ? `/?${params}` : "/");
      }
      void jsonRequest("/api/calendars/config", "GET").then(setCalendarConfig).catch(() => undefined);
      loadGroup(requestedGroup).then((activeGroup) => {
        if (!activeGroup && requestedGroup) setModal("join");
        else if (activeGroup && requestedGroup && activeGroup.slug !== requestedGroup) setModal("join");
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadGroup, showToast]);

  useEffect(() => {
    if (status !== "group" || !group) return;
    const timeout = window.setTimeout(() => { void findTimes(true); }, 0);
    return () => window.clearTimeout(timeout);
  }, [findTimes, group, status]);

  const uniqueMembers = useMemo(() => {
    if (!group) return [];
    const map = new Map<string, Member & { providers: string[] }>();
    group.members.forEach((member) => {
      const providerIsReady = member.provider === "google" ? calendarConfig.google
        : member.provider === "microsoft" ? calendarConfig.microsoft
        : member.provider === "mcp" ? calendarConfig.mcp
        : false;
      const provider = member.isDemo ? (calendarConfig.demo ? member.provider : null) : (providerIsReady ? member.provider : null);
      const existing = map.get(member.id);
      if (existing && provider) existing.providers.push(provider);
      else map.set(member.id, { ...member, providers: provider ? [provider] : [] });
    });
    return [...map.values()];
  }, [calendarConfig, group]);

  const connectedCount = uniqueMembers.filter((member) => member.providers.length).length;
  const connectedProviders = uniqueMembers.find((member) => member.id === group?.participantId)?.providers ?? [];
  const groupedSlots = useMemo(() => {
    const result = new Map<string, Slot[]>();
    slots.forEach((slot) => {
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(slot.start));
      result.set(key, [...(result.get(key) ?? []), slot]);
    });
    return [...result.entries()].slice(0, 4);
  }, [slots, timezone]);

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      let result: { slug: string; adminKey?: string };
      if (modal === "create") {
        result = await jsonRequest("/api/groups", "POST", data);
        setRecoveryKey(result.adminKey ?? "");
      } else if (modal === "recover") {
        result = await jsonRequest("/api/groups/recover", "POST", data);
        setRecoveryKey(String(data.adminKey ?? ""));
        showToast("Creator access restored");
      } else {
        result = await jsonRequest("/api/groups/join", "POST", data);
        setRecoveryKey("");
        showToast("You’re in");
      }
      window.history.replaceState({}, "", `/?group=${encodeURIComponent(result.slug)}`);
      await loadGroup(result.slug);
      setModal(modal === "create" ? "creatorKey" : null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not continue.");
    }
  }

  async function connect(provider: "google" | "microsoft") {
    setFormError("");
    try {
      const result = await jsonRequest("/api/calendars/connect", "POST", { provider });
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setModal(null);
      await loadGroup();
      showToast(result.mode === "demo"
        ? `${provider === "google" ? "Google" : "Microsoft"} demo calendar connected — no real calendar data is being used`
        : `${provider === "google" ? "Google" : "Microsoft"} Calendar connected`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not connect the calendar.");
    }
  }

  async function connectMcp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const accountId = String(new FormData(event.currentTarget).get("accountId") ?? "");
    try {
      await jsonRequest("/api/calendars/connect", "POST", { provider: "mcp", accountId });
      setModal(null);
      await loadGroup();
      showToast("Calendar MCP account connected");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not connect Calendar MCP.");
    }
  }

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const raw = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const payload = Object.fromEntries(Object.entries(raw).filter(([, value]) => value.trim()));
    try {
      const result = await jsonRequest("/api/groups/settings", "PATCH", payload);
      const nextSlug = result.slug ?? group?.slug;
      if (nextSlug) window.history.replaceState({}, "", `/?group=${encodeURIComponent(nextSlug)}`);
      setModal(null);
      await loadGroup(nextSlug);
      showToast("Group settings updated");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not update the group.");
    }
  }

  async function switchGroup(slug: string) {
    setRecoveryKey("");
    setModal(null);
    setSlots([]);
    window.history.replaceState({}, "", `/?group=${encodeURIComponent(slug)}`);
    await loadGroup(slug);
  }

  async function generateRecoveryKey() {
    setFormError("");
    try {
      const result = await jsonRequest("/api/groups/recovery-key", "POST");
      setRecoveryKey(result.adminKey);
      showToast("New creator recovery key generated");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not generate a recovery key.");
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.displayName} and their connected calendars from this group?`)) return;
    try {
      await jsonRequest(`/api/groups/members/${encodeURIComponent(member.id)}`, "DELETE");
      await loadGroup(group?.slug);
      showToast(`${member.displayName} removed`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not remove that person.");
    }
  }

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    showToast(message);
  }

  if (status === "loading") {
    return <main className="loading-screen"><Brand /><span className="loading-dot" /></main>;
  }

  if (status === "welcome") {
    const shared = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("group") ?? "";
    return (
      <main className="welcome">
        <header className="welcome-nav"><Brand /><a href="https://github.com/arnabdastidar/overlap-calendar" target="_blank" rel="noreferrer">Open source ↗</a></header>
        <section className="welcome-hero">
          <div className="hero-copy">
            <span className="hero-kicker">CALENDARS, WITHOUT THE CHAOS</span>
            <h1>Find the time<br />everyone <em>shares.</em></h1>
            <p>Connect Google or Microsoft calendars, then see the moments your whole group is free. Event details stay private.</p>
            <div className="hero-actions">
              <button className="primary-cta" onClick={() => setModal("create")}>Create a group <span>→</span></button>
              <button className="text-cta" onClick={() => setModal("join")}>Join a group</button>
            </div>
            <div className="privacy-line"><span>✓</span> No accounts or email login <i>·</i> Free/busy only <i>·</i> MIT licensed</div>
          </div>
          <div className="hero-demo">
            <div className="demo-window">
              <div className="demo-top"><span><i /><i /><i /></span><small>GROUP AVAILABILITY</small><b>•••</b></div>
              <div className="demo-title"><div><small>TEAM OFFSITE</small><strong>When can everyone meet?</strong></div><span className="demo-pill">6 connected</span></div>
              <div className="mini-controls"><span>60 minutes⌄</span><span>30 days⌄</span><button>Find times</button></div>
              <div className="demo-days">
                {["MON 24", "TUE 25", "WED 26"].map((day, index) => <div key={day}><small>{day}</small>{["9:30 AM", "1:00 PM", "3:30 PM"].map((time, timeIndex) => <span className={index === 1 && timeIndex === 1 ? "hit" : ""} key={time}>{time}{index === 1 && timeIndex === 1 && <b>✓</b>}</span>)}</div>)}
              </div>
              <div className="demo-selection"><small>SELECTED</small><strong>Tue, Aug 25 · 1:00 PM</strong></div>
            </div>
            <div className="floating-note"><span>◷</span><div><strong>12 shared openings</strong><small>across 6 calendars</small></div></div>
          </div>
        </section>
        <section className="how-strip"><span>01</span><p><strong>Create a private group</strong><small>Choose a name and password.</small></p><i>→</i><span>02</span><p><strong>Everyone connects</strong><small>Google or Microsoft calendars.</small></p><i>→</i><span>03</span><p><strong>Pick the overlap</strong><small>From 30 minutes to 5 hours.</small></p></section>
        {modal && ["create", "join", "recover"].includes(modal) && <AuthModal mode={modal as "create" | "join" | "recover"} sharedGroup={shared} error={formError} onClose={() => { setModal(null); setFormError(""); }} onSubmit={submitGroup} onMode={setModal} />}
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  if (!group) return null;
  const shareUrl = `${typeof window === "undefined" ? "" : window.location.origin}/?group=${group.slug}`;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Workspace navigation">
          <p className="nav-label">YOUR GROUPS</p>
          {group.accessibleGroups.map((item) => <button className={`group-row ${item.slug === group.slug ? "active" : ""}`} type="button" onClick={() => switchGroup(item.slug)} key={item.slug}>
            <span className="group-icon">{initials(item.groupName)}</span>
            <span><strong>{item.groupName}</strong><small>{item.role === "admin" ? "Creator" : "Member"}</small></span><b>›</b>
          </button>)}
          <button className="new-group" type="button" onClick={() => setModal("switch")}><span>＋</span> Create or join another</button>
        </nav>
        <div className="sidebar-note"><span>?</span><div><strong>Privacy first</strong><small>Only free/busy is read.</small></div></div>
        <p className="open-source">Open source · MIT</p>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">SHARED AVAILABILITY</span><button className="group-title-button" type="button" onClick={() => setModal("switch")}><h1>{group.groupName}</h1><span>⌄</span></button></div>
          <div className="top-actions">
            {group.role === "admin" && <button className="icon-button" aria-label="Group settings" onClick={() => setModal("settings")}>⚙</button>}
            <button className="share-button" onClick={() => setModal("share")}><span>↗</span> Share group</button>
          </div>
        </header>

        <div className="member-strip">
          <div className="avatars" aria-label={`${uniqueMembers.length} group members`}>
            {uniqueMembers.slice(0, 5).map((member) => <span className={`avatar ${member.color}`} key={member.id}>{initials(member.displayName)}</span>)}
            {uniqueMembers.length > 5 && <span className="avatar more">+{uniqueMembers.length - 5}</span>}
          </div>
          <div className="member-copy"><strong>{connectedCount} of {uniqueMembers.length} calendars connected</strong><span>{connectedCount === uniqueMembers.length ? "Everyone is ready to compare" : "Waiting for calendars to connect"}</span></div>
          <button className="manage-link" onClick={() => setModal("people")}>Manage people <span>→</span></button>
        </div>

        <section className="availability-card">
          <div className="card-heading">
            <div><h2>When can everyone meet?</h2><p>Only times when every connected calendar is free are shown.</p></div>
            <div className="timezone"><span>◉</span><div><small>TIME ZONE</small><strong>{timezone.replace("_", " ")}</strong></div></div>
          </div>
          <div className="filters">
            <label><span>MEETING LENGTH</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{durations.map((value) => <option value={value} key={value}>{durationLabel(value)}</option>)}</select></label>
            <label><span>LOOKING AHEAD</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[30, 60, 90, 180].map((value) => <option value={value} key={value}>{value === 180 ? "6 months" : `${value} days`}</option>)}</select></label>
            <div className="filter-field"><span>WORKING HOURS</span><button type="button">9:00 AM – 6:00 PM <b>⌄</b></button></div>
            <button className="find-button" type="button" onClick={() => findTimes()} disabled={finding}><span className={finding ? "spin" : ""}>↻</span> {finding ? "Checking…" : "Find times"}</button>
          </div>

          {!connectedCount ? (
            <div className="empty-state"><span className="empty-mark">◷</span><h3>Connect the first calendar</h3><p>Availability appears here as people in the group connect.</p><button onClick={() => setModal("connect")}>Connect your calendar <span>→</span></button></div>
          ) : (
            <>
              <div className="results-head"><p><span className="pulse" /> <strong>{slots.length} openings</strong> in the next {days === 180 ? "6 months" : `${days} days`}{source === "mcp" && <small className="source-tag"> via MCP</small>}</p></div>
              <div className="slot-grid">
                {groupedSlots.length ? groupedSlots.map(([day, daySlots]) => {
                  const [weekday, month, date] = day.replace(",", "").split(" ");
                  return <article className="day-column" key={day}><header><span>{weekday.toUpperCase()}</span><strong>{month} {date}</strong></header><div className="times">{daySlots.slice(0, 5).map((slot) => {
                    const isSelected = selected?.start === slot.start;
                    const time = new Intl.DateTimeFormat([], { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(slot.start));
                    return <button className={isSelected ? "selected" : ""} onClick={() => setSelected(slot)} key={slot.start}><span>{time}</span><small>{duration} min</small>{isSelected && <b>✓</b>}</button>;
                  })}</div></article>;
                }) : <div className="no-results"><strong>No shared openings yet</strong><span>Try a shorter meeting or a longer range.</span></div>}
              </div>
              {selected && <div className="selection-bar"><div><span>SELECTED TIME</span><strong>{new Intl.DateTimeFormat([], { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selected.start))}</strong><small>{timezone}</small></div><button type="button" onClick={() => copy(`${selected.start} / ${selected.end}`, "Time copied")}>Copy time</button></div>}
            </>
          )}
        </section>

        <section className="connection-card">
          <div className="provider-lockup"><span className="google-g">G</span><span className="microsoft-mark"><i /><i /><i /><i /></span></div>
          <div><strong>{connectedProviders.length ? "Your calendar is in the overlap" : "Bring your calendar into the overlap"}</strong><p>We only read free/busy status — event titles and details stay private.</p></div>
          <button type="button" onClick={() => setModal("connect")}>{connectedProviders.length ? "Manage calendars" : "Connect calendar"} <span>→</span></button>
        </section>
      </section>

      {modal === "connect" && <ConnectModal config={calendarConfig} connectedProviders={connectedProviders} error={formError} onClose={() => { setModal(null); setFormError(""); }} onConnect={connect} onConnectMcp={connectMcp} />}
      {modal === "share" && <ShareModal group={group} shareUrl={shareUrl} recoveryKey={recoveryKey} onCopy={copy} onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal group={group} error={formError} recoveryKey={recoveryKey} onClose={() => { setModal(null); setFormError(""); }} onSubmit={updateSettings} onGenerateRecoveryKey={generateRecoveryKey} />}
      {modal === "people" && <PeopleModal members={uniqueMembers} currentParticipantId={group.participantId} canManage={group.role === "admin"} onRemove={removeMember} onClose={() => setModal(null)} />}
      {modal === "switch" && <GroupSwitcher groups={group.accessibleGroups} activeSlug={group.slug} onSwitch={switchGroup} onCreate={() => setModal("create")} onJoin={() => { window.history.replaceState({}, "", "/"); setModal("join"); }} onRecover={() => { window.history.replaceState({}, "", "/"); setModal("recover"); }} onClose={() => setModal(null)} />}
      {modal === "creatorKey" && <CreatorKeyModal recoveryKey={recoveryKey} onCopy={copy} onClose={() => setModal(null)} />}
      {modal && ["create", "join", "recover"].includes(modal) && <AuthModal mode={modal as "create" | "join" | "recover"} sharedGroup={new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("group") ?? ""} error={formError} onClose={() => { setModal(null); setFormError(""); window.history.replaceState({}, "", `/?group=${encodeURIComponent(group.slug)}`); }} onSubmit={submitGroup} onMode={setModal} />}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function ModalShell({ children, onClose, className = "" }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${className}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Close">×</button>{children}</section></div>;
}

function AuthModal({ mode, sharedGroup, error, onClose, onSubmit, onMode }: { mode: "create" | "join" | "recover"; sharedGroup: string; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onMode: (modal: Modal) => void }) {
  const title = mode === "create" ? "Create your group" : mode === "recover" ? "Restore creator access" : "Join your group";
  const copy = mode === "create" ? "Start a private space for everyone’s availability." : mode === "recover" ? "Use the recovery key shown when the group was created." : "No account needed. Just use the shared group details.";
  return <ModalShell onClose={onClose} className="auth-modal"><span className="modal-kicker">{mode === "create" ? "START AN OVERLAP" : mode === "recover" ? "CREATOR RECOVERY" : "ENTER THE OVERLAP"}</span><h2>{title}</h2><p>{copy}</p><form onSubmit={onSubmit}>
    <label><span>GROUP NAME</span><input name={mode === "create" ? "name" : "group"} defaultValue={mode !== "create" ? sharedGroup : ""} placeholder="e.g. Design team" required /></label>
    {mode === "recover" ? <label><span>CREATOR RECOVERY KEY</span><input name="adminKey" placeholder="Paste your recovery key" required /></label> : <label><span>GROUP PASSWORD</span><input name="password" type="password" placeholder={mode === "create" ? "At least 6 characters" : "Enter the shared password"} minLength={6} required /></label>}
    <label><span>YOUR NAME</span><input name="displayName" placeholder="How the group will see you" required /></label>
    {error && <div className="form-error">{error}</div>}
    <button className="modal-primary" type="submit">{mode === "create" ? "Create group" : mode === "recover" ? "Restore access" : "Join group"} <span>→</span></button>
  </form><div className="modal-switch">{mode === "create" ? <>Already have a group? <button onClick={() => onMode("join")}>Join it</button></> : mode === "recover" ? <>Have the password? <button onClick={() => onMode("join")}>Join normally</button></> : <>Creating something new? <button onClick={() => onMode("create")}>Create a group</button><small>or</small><button onClick={() => onMode("recover")}>I’m the creator</button></>}</div></ModalShell>;
}

function ConnectModal({ config, connectedProviders, error, onClose, onConnect, onConnectMcp }: { config: CalendarConfig; connectedProviders: string[]; error: string; onClose: () => void; onConnect: (provider: "google" | "microsoft") => void; onConnectMcp: (event: FormEvent<HTMLFormElement>) => void }) {
  const googleAvailable = config.google || config.demo;
  const microsoftAvailable = config.microsoft || config.demo;
  const googleConnected = connectedProviders.includes("google");
  const microsoftConnected = connectedProviders.includes("microsoft");
  const noProvider = !googleAvailable && !microsoftAvailable && !config.mcp;
  return <ModalShell onClose={onClose}><span className="modal-kicker">YOUR CALENDAR</span><h2>{connectedProviders.length ? "Your calendars" : "Connect securely"}</h2><p>Overlap requests calendar-only access. We never request email, event notes, or contacts.</p><div className="provider-buttons"><button className={googleConnected ? "is-connected" : ""} disabled={!googleAvailable || googleConnected} onClick={() => onConnect("google")}><span className="google-g">G</span><div><strong>Google Calendar</strong><small>{googleConnected ? "Connected to this overlap" : config.google ? "Free/busy access · Personal or Workspace" : config.demo ? "Demo data only · no calendar access" : "Not configured by this deployment"}</small></div><b>{googleConnected ? "✓ Connected" : googleAvailable ? "→" : "—"}</b></button><button className={microsoftConnected ? "is-connected" : ""} disabled={!microsoftAvailable || microsoftConnected} onClick={() => onConnect("microsoft")}><span className="microsoft-mark"><i /><i /><i /><i /></span><div><strong>Microsoft Outlook</strong><small>{microsoftConnected ? "Connected to this overlap" : config.microsoft ? "Read-only access · Personal or Microsoft 365" : config.demo ? "Demo data only · no calendar access" : "Not configured by this deployment"}</small></div><b>{microsoftConnected ? "✓ Connected" : microsoftAvailable ? "→" : "—"}</b></button></div>{config.mcp && <details className="mcp-connect"><summary>Use an admin-provisioned Calendar MCP account</summary><p>The MCP administrator must authenticate your account first.</p><form onSubmit={onConnectMcp}><input name="accountId" placeholder="MCP account ID" required /><button type="submit">Connect MCP</button></form></details>}{noProvider && <div className="provider-setup-note"><strong>Calendar access is not configured</strong><span>The deployment owner must add Google or Microsoft OAuth credentials before anyone can connect a real calendar.</span></div>}{config.demo && <div className="demo-warning">Demo calendars are enabled. They use generated busy blocks, not provider data.</div>}{error && <div className="form-error">{error}</div>}<div className="privacy-box"><span>♢</span><p><strong>Your schedule stays yours</strong><small>Only busy time blocks are compared. Event content is never saved.</small></p></div></ModalShell>;
}

function ShareModal({ group, shareUrl, recoveryKey, onCopy, onClose }: { group: Group; shareUrl: string; recoveryKey: string; onCopy: (value: string, message: string) => void; onClose: () => void }) {
  return <ModalShell onClose={onClose}><span className="modal-kicker">INVITE YOUR GROUP</span><h2>Share the overlap</h2><p>Send the link and password separately. Anyone with both can join.</p><label className="copy-field"><span>GROUP LINK</span><div><input value={shareUrl} readOnly /><button onClick={() => onCopy(shareUrl, "Group link copied")}>Copy</button></div></label><label className="copy-field"><span>GROUP NAME</span><div><input value={group.groupName} readOnly /><button onClick={() => onCopy(group.groupName, "Group name copied")}>Copy</button></div></label>{recoveryKey && <div className="recovery-note"><strong>Save your creator recovery key</strong><code>{recoveryKey}</code><button onClick={() => onCopy(recoveryKey, "Recovery key copied")}>Copy key</button></div>}<small className="share-hint">For privacy, the group password is never displayed after setup.</small></ModalShell>;
}

function SettingsModal({ group, error, recoveryKey, onClose, onSubmit, onGenerateRecoveryKey }: { group: Group; error: string; recoveryKey: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onGenerateRecoveryKey: () => void }) {
  return <ModalShell onClose={onClose}><span className="modal-kicker">CREATOR SETTINGS</span><h2>Group settings</h2><p>Leave a field blank to keep its current value.</p><form onSubmit={onSubmit}><label><span>GROUP NAME</span><input name="name" defaultValue={group.groupName} /></label><label><span>NEW PASSWORD</span><input name="password" type="password" minLength={6} placeholder="At least 6 characters" /></label>{error && <div className="form-error">{error}</div>}<button className="modal-primary" type="submit">Save changes <span>→</span></button></form><div className="recovery-settings"><strong>Creator recovery</strong><p>The recovery key is different from the group password. Generating a new key disables the previous one.</p>{recoveryKey ? <label className="copy-field"><span>RECOVERY KEY</span><div><input value={recoveryKey} readOnly /><button onClick={() => navigator.clipboard.writeText(recoveryKey)}>Copy</button></div></label> : <button className="secondary-button" type="button" onClick={onGenerateRecoveryKey}>Generate a new recovery key</button>}</div></ModalShell>;
}

function PeopleModal({ members, currentParticipantId, canManage, onRemove, onClose }: { members: Array<Member & { providers: string[] }>; currentParticipantId: string; canManage: boolean; onRemove: (member: Member) => void; onClose: () => void }) {
  return <ModalShell onClose={onClose}><span className="modal-kicker">GROUP MEMBERS</span><h2>People in this overlap</h2><p>{canManage ? "As the creator, you can remove duplicate or former members." : "Only the group creator can remove people."}</p><div className="people-list">{members.map((member) => <div key={member.id}><span className={`avatar ${member.color}`}>{initials(member.displayName)}</span><p><strong>{member.displayName}{member.id === currentParticipantId ? " (you)" : ""}</strong><small>{member.providers.length ? member.providers.map((item) => item === "google" ? "Google" : item === "microsoft" ? "Microsoft" : "MCP").join(" + ") : "Calendar not connected"}</small></p><b className={member.providers.length ? "ready" : ""}>{member.providers.length ? "Ready" : "Waiting"}</b>{canManage && member.id !== currentParticipantId && <button className="remove-member" type="button" onClick={() => onRemove(member)}>Remove</button>}</div>)}</div></ModalShell>;
}

function GroupSwitcher({ groups, activeSlug, onSwitch, onCreate, onJoin, onRecover, onClose }: { groups: GroupAccess[]; activeSlug: string; onSwitch: (slug: string) => void; onCreate: () => void; onJoin: () => void; onRecover: () => void; onClose: () => void }) {
  return <ModalShell onClose={onClose}><span className="modal-kicker">YOUR OVERLAPS</span><h2>Switch groups</h2><p>This browser keeps each group separate, including its calendars and creator access.</p><div className="group-switch-list">{groups.map((item) => <button type="button" className={item.slug === activeSlug ? "active" : ""} onClick={() => onSwitch(item.slug)} key={item.slug}><span className="group-icon">{initials(item.groupName)}</span><span><strong>{item.groupName}</strong><small>{item.role === "admin" ? "Creator" : "Member"}</small></span><b>{item.slug === activeSlug ? "Current" : "Open"}</b></button>)}</div><div className="group-switch-actions"><button className="modal-primary" type="button" onClick={onCreate}>Create a new group</button><button className="secondary-button" type="button" onClick={onJoin}>Join an existing group</button><button className="text-button" type="button" onClick={onRecover}>Restore creator access</button></div></ModalShell>;
}

function CreatorKeyModal({ recoveryKey, onCopy, onClose }: { recoveryKey: string; onCopy: (value: string, message: string) => void; onClose: () => void }) {
  return <ModalShell onClose={onClose}><span className="modal-kicker">CREATOR RECOVERY</span><h2>Save this key now</h2><p>This recovery key is different from the group password. It restores creator controls if this browser loses access, and it remains visible only until the page is reloaded.</p><label className="copy-field"><span>CREATOR RECOVERY KEY</span><div><input value={recoveryKey} readOnly /><button onClick={() => onCopy(recoveryKey, "Recovery key copied")}>Copy key</button></div></label><button className="modal-primary" type="button" onClick={onClose}>I saved the key <span>→</span></button></ModalShell>;
}
