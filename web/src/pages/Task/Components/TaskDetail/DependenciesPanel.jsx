import { GitBranch, Link2 } from "lucide-react";

import { Button, Combobox } from "../../../../components/ui";
import DepSection from "./DepSection";

export default function DependenciesPanel({ deps, taskId, canEdit }) {
  const {
    blockers,
    dependents,
    potentialDepOptions,
    blockerPick,
    setBlockerPick,
    dependentPick,
    setDependentPick,
    addBlocker,
    addDependent,
    removeDependency,
    isAdding,
  } = deps;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <DepSection
        title={`Blocked by (${blockers.length})`}
        items={blockers}
        emptyText="No blockers"
        tone="error"
        canEdit={canEdit}
        onRemove={(d) => removeDependency(taskId, d.TaskId)}
      />
      {canEdit && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1 }}>
            <Combobox
              options={potentialDepOptions.filter(
                (o) => !blockers.some((b) => b.TaskId === o.value),
              )}
              value={blockerPick}
              onChange={setBlockerPick}
              placeholder="Pick a task that blocks this one"
              size="sm"
              data-testid="blocker-pick"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Link2 size={14} />}
            onClick={addBlocker}
            disabled={!blockerPick}
            loading={isAdding}
            data-testid="add-blocker-btn"
          >
            Add blocker
          </Button>
        </div>
      )}

      <DepSection
        title={`Blocking (${dependents.length})`}
        items={dependents}
        emptyText="Nothing waiting on this task"
        tone="info"
        canEdit={canEdit}
        onRemove={(d) => removeDependency(d.TaskId, taskId)}
      />
      {canEdit && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1 }}>
            <Combobox
              options={potentialDepOptions.filter(
                (o) => !dependents.some((d) => d.TaskId === o.value),
              )}
              value={dependentPick}
              onChange={setDependentPick}
              placeholder="Pick a task that waits on this one"
              size="sm"
              data-testid="dependent-pick"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<GitBranch size={14} />}
            onClick={addDependent}
            disabled={!dependentPick}
            loading={isAdding}
            data-testid="add-dependent-btn"
          >
            Add dependent
          </Button>
        </div>
      )}
    </div>
  );
}
