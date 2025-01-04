import { Plot } from "@/utils/dataTypes";
import "./page.scss"

export default function Page(props: {
  plot: Plot,
  chooseBlock?: (plotId: string | null, commentId: string | null) => void,
  id: string
}) {
  return (
    <div 
      className="SingleDialog content-item"
      onClick={props.chooseBlock ? () => props.chooseBlock!(props.id, null) : () => {}}
      id={props.id}
    >
      <span className="SingleDialog speaker">{props.plot.speaker}:</span>
      <span className="SingleDialog dialog">{props.plot.dialog}</span>
    </div>
  )
}