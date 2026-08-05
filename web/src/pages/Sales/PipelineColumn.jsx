import BoardColumn from "../../components/ui/BoardColumn";
import PipelineCard from "./PipelineCard";

export default function PipelineColumn({ stage, leads }) {
  return (
    <BoardColumn stage={stage} count={leads.length} testId={`pipeline-stage-${stage.Id}`}>
      {leads.map((lead) => (
        <PipelineCard key={lead.Id} lead={lead} stageId={stage.Id} />
      ))}
    </BoardColumn>
  );
}
