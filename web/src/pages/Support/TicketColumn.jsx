import BoardColumn from "../../components/ui/BoardColumn";
import TicketCard from "./TicketCard";

export default function TicketColumn({ stage, tickets, priorityById, users, onOpen }) {
  return (
    <BoardColumn stage={stage} count={tickets.length} testId={`ticket-stage-${stage.Id}`}>
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.Id}
          ticket={ticket}
          stageId={stage.Id}
          priorityById={priorityById}
          users={users}
          onOpen={onOpen}
        />
      ))}
    </BoardColumn>
  );
}
