import { useTheme } from "@mui/material/styles";

import { Avatar, Button, Chip, Tooltip } from "../../components/ui";
import { LIVE_BUCKETS, NUMBERS, numberLabel, presenceLine, statusWord } from "./todayWords";

export function StatusPill({ person }) {
  const w = statusWord(person);
  const pill = <Chip size="sm" tone={w.tone} label={w.label} />;
  // Hover or keyboard focus explains the word; the word itself is unchanged.
  return w.hint ? <Tooltip title={w.hint}><span tabIndex={0}>{pill}</span></Tooltip> : pill;
}

/** One number: a button when there is something behind it, grey when 0, a dash when not known for the day. */
export function Count({ person, k, tone, live, onOpen, testId, big }) {
  const p = useTheme().tokens;
  const raw = person.counts?.[k];
  const unknown = raw == null || (!live && LIVE_BUCKETS.has(k));
  const label = numberLabel(k, live);
  const style = {
    fontSize: big ? "calc(18rem / 15)" : "calc(14rem / 15)", fontWeight: 700, fontFamily: "inherit",
    color: unknown || raw === 0 ? p.text.tertiary : tone ? p[tone].hover : p.text.primary,
  };
  if (unknown || raw === 0) return <span data-testid={testId} style={style}>{unknown ? "—" : 0}</span>;
  return (
    <button type="button" data-testid={testId} aria-label={`${label}: ${raw}`} onClick={() => onOpen(person, k)}
      style={{ ...style, background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: "0.2em" }}>
      {raw}
    </button>
  );
}

export function Actions({ person, canSessions, onMark, onSessions, nowrap = false }) {
  return (
    <span style={{ display: "inline-flex", gap: "calc(6rem / 15)", flexWrap: nowrap ? "nowrap" : "wrap", whiteSpace: nowrap ? "nowrap" : undefined }}>
      <Tooltip title="Record leave (full or half day) or working away from office (on duty) for this person on the chosen day. Past days are fine.">
        <span><Button size="sm" variant="outlined" onClick={() => onMark(person)} data-testid={`mark-day-${person.UserId}`}>Leave / on duty</Button></span>
      </Tooltip>
      {canSessions && !person.isMe && (
        <Tooltip title="Admin only: see this person's sign-in history and sign them out everywhere, for example if a phone is lost.">
          <span><Button size="sm" variant="outlined" onClick={() => onSessions(person)} data-testid={`sessions-${person.UserId}`}>Sign-ins</Button></span>
        </Tooltip>
      )}
    </span>
  );
}

/** One person's day on My team (spec §2.2). */
export default function PersonCard({ person, office, live, onOpen, onMark, onSessions, canSessions }) {
  const p = useTheme().tokens;
  const c = person.counts ?? {};
  const id = person.UserId;
  const alert = (live && c.overdue > 0) || person.status?.code === "not_signed_in";
  const missed = live ? [c.reasonOwed > 0 && `${c.reasonOwed} waiting for reason`, c.toRule > 0 && `${c.toRule} waiting for your ruling`].filter(Boolean) : [];
  // A blank job title is often stored as "-"; never show a lone dash.
  const role = [person.JobTitle, office].map((v) => String(v ?? "").trim()).filter((v) => v && v !== "-").join(" · ");

  return (
    <article data-testid={`person-card-${id}`} data-alert={String(alert)} className="nx-raised nx-lift"
      style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)", padding: "calc(16rem / 15)", minWidth: 0, background: p.surface.card, borderRadius: "calc(14rem / 15)", border: `1px solid ${p.border.default}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)", flexWrap: "wrap" }}>
        <Avatar name={person.FullName} size="lg" online={person.status?.code === "online"} />
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(2rem / 15)", minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "calc(6rem / 15)", fontWeight: 700, fontSize: "calc(15rem / 15)", color: p.text.primary, overflowWrap: "anywhere" }}>
            {person.FullName}
            {/* Needs attention: a small dot by the name, not a red card edge. */}
            {alert && (
              <span role="img" aria-label="Needs attention" title="Needs attention" data-testid={`attention-${id}`}
                style={{ width: "calc(8rem / 15)", height: "calc(8rem / 15)", borderRadius: "50%", background: p.error.main, flexShrink: 0 }} />
            )}
            {person.isMe && <Chip size="sm" tone="primary" label="You" />}
          </div>
          {role && <div style={{ fontSize: "calc(12rem / 15)", color: p.text.secondary }}>{role}</div>}
        </div>
        <StatusPill person={person} />
      </div>

      <div style={{ fontSize: "calc(13rem / 15)", color: p.text.secondary, fontWeight: 500 }}>{presenceLine(person, live)}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(calc(72rem / 15), 1fr))", border: `1px solid ${p.border.subtle}`, borderRadius: "calc(10rem / 15)", overflow: "hidden" }}>
        {NUMBERS.map(({ key, tone }) => {
          const hot = tone && live && c[key] > 0;
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: "calc(2rem / 15)", padding: "calc(10rem / 15) calc(8rem / 15)", borderRight: `1px solid ${p.border.subtle}`, background: hot ? p[tone].subtle : undefined }}>
              <Count person={person} k={key} tone={tone} live={live} onOpen={onOpen} testId={`n-${id}-${key}`} big />
              <span style={{ fontSize: "calc(11rem / 15)", color: p.text.secondary, fontWeight: 600, lineHeight: 1.25 }}>{numberLabel(key, live)}</span>
            </div>
          );
        })}
      </div>

      {missed.length > 0 && (
        <div data-testid={`missed-${id}`} style={{ display: "flex", alignItems: "center", gap: "calc(10rem / 15)", padding: "calc(10rem / 15) calc(12rem / 15)", background: p.error.subtle, borderRadius: "calc(10rem / 15)" }}>
          <span style={{ fontSize: "calc(13rem / 15)", color: p.error.hover, fontWeight: 600, flex: 1 }}>{missed.join(" · ")}</span>
          {/* ponytail: the team payload carries counts, not clocks, so Rule opens the waiting-for-ruling tasks; each links to its task's Deadline panel */}
          {c.toRule > 0 && <Button size="sm" variant="destructive" onClick={() => onOpen(person, "toRule")}>Rule</Button>}
        </div>
      )}

      <Actions person={person} canSessions={canSessions} onMark={onMark} onSessions={onSessions} />
    </article>
  );
}
