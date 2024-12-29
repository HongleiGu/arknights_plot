import { listChoices, listOutcomes } from "@/utils/api";
import { Plot, Choice, Outcome } from "@/utils/dataTypes";
import { useEffect, useState } from "react";
import SingleOutcome from "../SingleOutcome/page"

// 传入的是一个plot,然后会根据这个plot查找对应的choices
export default function Page(props: {
  plot: Plot,
  decisionId: number,
  chooseBlock: (plotId: string | null, commentId: string | null) => void,
  id: string
}) {
  const [decisionValue, setDecisionValue] = useState<number>(1);
  const [choices, setChoices] = useState<Choice[]>([])
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  useEffect(() => {
    const helper = async () => {
      const res = await listChoices(
        props.decisionId, 
        props.plot.chapter, 
        props.plot.story
      )
      setChoices(res)
    }
    helper()
  }, [props.plot.chapter, props.decisionId, props.plot.story])
  const choose = async (decisionValue: number) => {
    const res = await listOutcomes(
      props.decisionId,
      props.plot.chapter,
      props.plot.story,
      decisionValue
    )
    setOutcomes(res)
  }
  const clickChoose = (decisionV: number) => {
    setDecisionValue(decisionV)
    props.chooseBlock(props.id, null)
    // props.chooseBlock(`choice${props.decisionId}-decisionValue${decisionValue}`, null)
    choose(decisionValue)
  }
  return (
    <div className="SingleChoice wrapper">
      <div className="SingleChoice content-item" id={`choice${props.decisionId}`}>
      {choices.map((item: Choice, index: number) => (
        <div
          className="choice"
          key={item.choiceId}
          onClick={() => clickChoose(index + 1)}
        >
          <span id={`choice${props.decisionId}-decisionValue${decisionValue}`}>
            {item.decision}
          </span>
        </div>
      ))}
      </div>
      {outcomes.map((outcome: Outcome) => 
          <SingleOutcome 
            // v-for="(outcome, index) in outcome"
            // :outcomeId="outcome.outcomeId"
            // :decisionId="outcome.decisionId"
            // :dialog="outcome.dialog"
            // :speaker="outcome.speaker"
            // :dialogType="outcome.dialogType"
            // :story="outcome.story"
            // :chapter="outcome.chapter"
            // :decisionValue="outcome.decisionValue"
            // :storyType="outcome.storyType"
            outcome={outcome}
            id={`choice${props.decisionId}-outcome${outcome.outcomeId}`} 
            key={outcome.outcomeId}
            chooseBlock={props.chooseBlock}
          >
          </SingleOutcome>
        )
      }
    </div>
  )
}