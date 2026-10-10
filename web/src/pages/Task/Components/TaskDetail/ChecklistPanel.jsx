import { CheckSquare, Plus } from "lucide-react";

import { Button, TextInput, EmptyState } from "../../../../components/ui";
import ChecklistRow from "./ChecklistRow";

export default function ChecklistPanel({
  checklist,
  canProgressThisTask,
  canManageArtifacts,
}) {
  const {
    checklistItems,
    newChecklistItem,
    setNewChecklistItem,
    pendingChecklist,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    isSaving,
  } = checklist;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(8rem / 15)" }}>
      {checklistItems.length === 0 ? (
        <EmptyState
          icon={<CheckSquare size={28} />}
          title="No checklist yet"
          description="Break this task into quick steps. Tick them off as you go."
          size="sm"
        />
      ) : (
        checklistItems.map((it) => (
          <ChecklistRow
            key={it.Id}
            item={it}
            canToggle={canProgressThisTask}
            // The last step stays: a task with no steps can never complete (094).
            canDelete={canManageArtifacts && checklistItems.length > 1}
            pending={pendingChecklist.has(it.Id)}
            onToggle={() => toggleChecklistItem(it)}
            onDelete={() => removeChecklistItem(it)}
          />
        ))
      )}
      {canManageArtifacts && (
        <div
          style={{
            display: "flex",
            gap: "calc(8rem / 15)",
            alignItems: "center",
            marginTop: "calc(6rem / 15)",
          }}
        >
          <TextInput
            value={newChecklistItem}
            onChange={(e) => setNewChecklistItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addChecklistItem();
            }}
            placeholder="Add a step…"
            size="sm"
            data-testid="checklist-input"
          />
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={addChecklistItem}
            loading={isSaving}
            data-testid="checklist-add"
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
