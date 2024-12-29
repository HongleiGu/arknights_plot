import { Outcome } from "@/utils/dataTypes";

export default function Page(props: {
  outcome: Outcome,
  id: string,
  chooseBlock: (plotId: string | null, commentId: string | null) => void
}) {
  return (
    <div 
      className="SingleOutcome content-item" 
      id={props.id}
      onClick={() => props.chooseBlock(props.id, null)}
    >
      <span className="SingleOutcome speaker">{props.outcome.speaker}:</span>
      <span className="SingleOutcome dialog">{props.outcome.dialog}</span>
    </div>
  )
}