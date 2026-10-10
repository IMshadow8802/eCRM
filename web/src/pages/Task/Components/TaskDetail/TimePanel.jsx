import { Clock } from "lucide-react";

import { Button, EmptyState } from "../../../../components/ui";
import TimeEntryRow from "./TimeEntryRow";

export default function TimePanel({
  time,
  estimatedHours,
  canLogTime,
  canEditThisTask,
  currentUserId,
}) {
  const {
    timeEntries,
    loggedHoursTotal,
    setLogOpen,
    removeTimeEntry,
  } = time;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "calc(13rem / 15)",
        }}
      >
        <div>
          Total logged: <strong>{loggedHoursTotal.toFixed(2)} h</strong>
          {estimatedHours > 0 && (
            <> / {estimatedHours.toFixed(2)} h estimated</>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Clock size={14} />}
          onClick={() => setLogOpen(true)}
          disabled={!canLogTime}
        >
          Log time
        </Button>
      </div>
      {timeEntries.length === 0 ? (
        <EmptyState
          icon={<Clock size={28} />}
          title="No time logged"
          description="Track real hours as you work so the team sees actuals vs estimate."
          size="sm"
        />
      ) : (
        timeEntries.map((e) => (
          <TimeEntryRow
            key={e.Id}
            entry={e}
            canEdit={canEditThisTask || e.UserId === currentUserId}
            onDelete={() => removeTimeEntry(e)}
          />
        ))
      )}
    </div>
  );
}
