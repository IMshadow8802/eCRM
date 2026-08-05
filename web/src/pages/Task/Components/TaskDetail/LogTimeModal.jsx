import { Clock } from "lucide-react";

import {
  Modal,
  Button,
  NumberInput,
  TextArea,
} from "../../../../components/ui";

export default function LogTimeModal({ time, task }) {
  const {
    logOpen,
    setLogOpen,
    logHours,
    setLogHours,
    logNote,
    setLogNote,
    submitLogTime,
    isLogging,
  } = time;

  return (
    <Modal
      open={logOpen}
      onClose={() => setLogOpen(false)}
      size="sm"
      data-testid="log-time-modal"
    >
      <Modal.Header
        title="Log time"
        subtitle={task ? `On "${task.Title}"` : ""}
        icon={<Clock size={18} />}
        onClose={() => setLogOpen(false)}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <NumberInput
            label="Hours"
            value={logHours}
            onChange={(e) => setLogHours(Number(e.target.value) || 0)}
            min={0}
            step={0.25}
            autoFocus
            data-testid="log-time-hours"
          />
          <TextArea
            label="Note (optional)"
            value={logNote}
            onChange={(e) => setLogNote(e.target.value)}
            rows={3}
            placeholder="What did you work on?"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={() => setLogOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submitLogTime}
          loading={isLogging}
          data-testid="log-time-submit"
        >
          Log
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
