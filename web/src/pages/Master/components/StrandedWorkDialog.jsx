// src/pages/Master/components/StrandedWorkDialog.jsx
//
// Shown after a role or user save that leaves open leads/complaints with
// someone who can no longer act on them. The server has already told their
// manager; this only says so. `people` = [{ name, leads, complaints }].
import React from "react";
import { Modal, Button } from "../../../components/ui";

const line = (n, what, name) =>
  `${n} open ${what}${n === 1 ? " is" : "s are"} still assigned to ${name}`;

export default function StrandedWorkDialog({ people = [], onClose }) {
  return (
    <Modal open={people.length > 0} onClose={onClose} size="sm" data-testid="stranded-dialog">
      <Modal.Header title="Open work left behind" onClose={onClose} />
      <Modal.Body>
        <ul style={{ margin: 0, paddingLeft: "calc(18rem / 15)" }}>
          {people.flatMap(({ name, leads, complaints }, i) => [
            complaints > 0 && <li key={`${i}-c`}>{line(complaints, "complaint", name)}</li>,
            leads > 0 && <li key={`${i}-l`}>{line(leads, "lead", name)}</li>,
          ]).filter(Boolean)}
        </ul>
        <p style={{ marginBottom: 0 }}>Their manager has been told.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" onClick={onClose}>OK</Button>
      </Modal.Footer>
    </Modal>
  );
}
