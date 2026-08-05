import { History } from "lucide-react";

import { EmptyState } from "../../../../components/ui";
import ActivityRow from "./ActivityRow";

export default function HistoryPanel({ activities }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column" }}
      data-testid="task-history"
    >
      {activities.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title="No history yet"
          description="Every change — added, ticked, edited, deleted — shows up here with who did it and when."
          size="sm"
        />
      ) : (
        activities.map((a, i) => (
          <ActivityRow
            key={a.Id}
            activity={a}
            isLast={i === activities.length - 1}
          />
        ))
      )}
    </div>
  );
}
