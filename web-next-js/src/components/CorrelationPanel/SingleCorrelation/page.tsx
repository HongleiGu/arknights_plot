import { CorrelationCommentPair } from "@/utils/dataTypes"
import SingleMargin from "../../ReadPage/SingleMargin/page"
import { Button, Col, Row } from "antd"
import "./page.scss"
import { useState } from "react"
import { setCorrelationContent } from "@/utils/api"

export default function Page({correlationCommentPair, onDelete}: {correlationCommentPair: CorrelationCommentPair, onDelete: (id: number) => void}) {
  const [edit, setEdit] = useState<boolean>(false)
  const [content, setContent] = useState<string>(correlationCommentPair.correlation.correlationContent)

  const update = async () => {
    if (!edit) {
      setEdit(true)
    } else {
      await setCorrelationContent(correlationCommentPair.correlation.correlationId, content)
      setEdit(false)
    }
  }

  return (
    <div className="SingleCorrelation content">
      <Row gutter={10}>
        <Col span={12}>
          <SingleMargin comment={correlationCommentPair.comment} id={'margin'+correlationCommentPair.comment.commentId}/>
        </Col>
        <Col span={6}>
        <div className="area">
          { edit ?
          <textarea value={content} onChange={e => setContent(e.currentTarget.value)}></textarea>
          :
          <span>{content}</span>}
        </div>
        </Col>
        <Col span={6}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'row',
            justifyItems: 'center'
          }}
        >
          <div className="m-[10px]">
            <Button onClick={() => onDelete(correlationCommentPair.correlation.correlationId)}>-</Button>
          </div>
          <div className="m-[10px]">
            <Button onClick={() => update()}>修改</Button>
          </div>
        </Col>
      </Row>
    </div>
  )
}