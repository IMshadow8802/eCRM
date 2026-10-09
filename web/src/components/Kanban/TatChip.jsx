import { useEffect, useState } from "react";

import { Chip, Tooltip } from "../ui";
import { tatChip, tatSentence } from "../../utils/tatChip";

const TONE = { ok: "success", warn: "warning", over: "error", held: "default" };

// Text + icon, never colour alone. Re-reads the clock each minute so a card
// left on screen turns amber/red without waiting for a refetch.
export default function TatChip({ task }) {
  const [now, setNow] = useState(() => new Date());
  const ticking = Boolean(task?.TatDueAt && !task.TatHeldSince);
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, [ticking]);
  const chip = tatChip(task, now);
  if (!chip) return null;
  const Icon = chip.icon;
  return (
    <Tooltip title={tatSentence(task, now)}>
      <span style={{ display: "inline-flex" }}>
      <Chip
        label={chip.text}
        icon={<Icon size={11} />}
        tone={TONE[chip.tone]}
        size="sm"
        variant="tonal"
        aria-label={tatSentence(task, now)}
        data-tone={chip.tone}
        data-testid={`card-tat-${task.Id}`}
      />
      </span>
    </Tooltip>
  );
}
