import { Col, Modal, Row } from "antd";
import { Comment } from "@/utils/dataTypes";
import SingleMargin from "@/components/ReadPage/SingleMargin/page"

export default function Page(props:{comment: Comment | null, handleClose: () => void}) {
  return (
    <Modal 
      open={props.comment != null}
      onOk={() => props.handleClose()}
      onCancel={() => props.handleClose()}
      onClose={() => props.handleClose()}
    >
      <Row gutter={16}>
        <Col span={8}>
          <span>当前批注</span>
          {props.comment != null ? 
          <SingleMargin 
            comment={props.comment}
            id={'margin'+props.comment.commentId}
          />: null}
        </Col>
        <Col span={8}>
          <div>
            current correlation
          </div>
        </Col>
        <Col span={8}>
          <div>
            all the comments
          </div>
        </Col>
      </Row>
    </Modal>
  )
}