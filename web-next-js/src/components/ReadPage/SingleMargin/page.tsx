import { Comment, CommentTag, Plot } from "@/utils/dataTypes"
import { useEffect, useRef, useState } from "react"
import "./page.scss"
import ClosableTagGroup from '@/components/ClosableTagGroup/page'
import { addCommentTag, deleteCommentTag, getCommentTag, getSpecificDialog } from "@/utils/api"
import { Popover } from "antd"
import SingleDialog from "../SingleDialog/page"
// import { Input } from 'antd';
// 
// import { Tag } from 'antd';

// const { Option } = Select;

export default function Page(props: {
  comment: Comment,
  deleteComments?: (commentId: number) => void,
  editComments?: (commentId: number, commentContent: string) => void,
  chooseBlock?: (plotId: string | null, commentId: string | null) => void
  triggerCorrelationPanel?: (comment: Comment) => void,
  id: string
}) {
  
  const [disabled, setDisabled] = useState(false)
  const [tag, setTag] = useState<CommentTag[]>([])
  // const [addingTag, setAddingTag] = useState<boolean>(false)
  // const [addingTagContent, setAddingTagContent] = useState<string>("")

  const contentSpan = useRef<HTMLSpanElement>(null)
  const contentTextarea = useRef<HTMLTextAreaElement>(null)
  const [message, setMessage] = useState<string>(props.comment.commentContent);

  const [dialog, setDialog] = useState<Plot | null>(null)

  // const emit = defineEmits(['deleteComments', 'editComments','chooseBlock'])
  const deleteThis = () => {
    if (props.deleteComments != undefined) {
      props.deleteComments(props.comment.commentId)
    }
  }

  const editThis = () => {
    setDisabled(!disabled)
    // console.log(props.comment)
    // if (disabled === true){
    //   props.editComments(props.comment.commentId, (contentSpan.current?.innerText || contentTextarea.current?.innerText)!)
    // }
  }

  useEffect(() => {
    console.log(disabled)
    if (disabled === true){
      console.log(message)
      if (props.editComments != undefined) {
        props.editComments(props.comment.commentId, message)
      }
    }
  }, [disabled])

  useEffect(() => {
    const helper = async () => {
      setTag(await getCommentTag(props.comment.commentId))
    }
    setDisabled(true)
    helper()
  }, [props.comment.commentId])

  return (
      <div 
        className="SingleMargin"
        onClick={props.chooseBlock ? () => props.chooseBlock!(null, props.id): () => {}}
      >
        <div className="SingleMargin margin-item" id={props.id}>
        <div className="SingleMargin info">
          <span className="SingleMargin username-title">用户:{props.comment.username}</span>
          {/* <span className="SingleMargin tag-title">标签:</span> */}
        </div>
        <div className="SingleMargin content">
          {disabled ?
            <span
              className="SingleMargin content-item"
              ref={contentSpan}
            >
              {message}
            </span>
            :
            <textarea
              // type="text"
              className="SingleMargin content-item"
              ref={contentTextarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            >
            </textarea>}
            <span className="text">标签:</span>
            <ClosableTagGroup
              initialTags={tag}
              onClose={deleteCommentTag}
              onInputComfirm={addCommentTag}
              refresh={async () => {
                setTag(await getCommentTag(props.comment.commentId))
              }}
            />
            {/* <div className="tags">
              {tag?.map((it,index) => 
                <Tag closable key={index}>{it.tag}</Tag>
              )}
              <div 
                className="tag"
              >
                {addingTag ?
                <Input
                  style={{width:78}}
                  placeholder="标签"
                  value={addingTagContent}
                  onChange={e => setAddingTagContent(e.target.value)}
                  onPressEnter={() => {addCommentTag(addingTagContent, props.comment.commentId);setAddingTag(false);}}
                />
                :<span onClick={() => setAddingTag(true)}>+</span>}
              </div>
            </div> */}
        </div>
        <Popover 
          content={
            dialog ? <SingleDialog
              id=""
              plot={dialog!}
            /> : <span>loading ...</span>
          } 
          onOpenChange={dialog ? () => console.log(dialog) : async () => setDialog(await getSpecificDialog(props.comment.story, props.comment.chapter, props.comment.dialogId))}
          title="Title"
          className="SingleDialog showDialog"
        >
          <button>显示原文</button>
        </Popover>
        {props.deleteComments ? <button className="SingleMargin delete" onClick={deleteThis}>删除</button> : null}
        {props.editComments ? <button className="SingleMargin edit" onClick={editThis}>编辑</button> : null}
        {props.triggerCorrelationPanel ? <button className="SingleMargin add-answer" onClick={() => {console.log(props.triggerCorrelationPanel);props.triggerCorrelationPanel!(props.comment)}}>添加关联</button> : null}
      </div>
    </div>
  )
}