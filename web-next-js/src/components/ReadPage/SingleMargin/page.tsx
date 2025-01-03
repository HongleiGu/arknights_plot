import { Comment } from "@/utils/dataTypes"
import { useEffect, useRef, useState } from "react"
import "./page.scss"
import { getCommentTag } from "@/utils/api"

// import { Select } from 'antd';

// const { Option } = Select;

export default function Page(props: {
  comment: Comment,
  deleteComments: (commentId: number) => void,
  editComments: (commentId: number, commentContent: string) => void,
  chooseBlock: (plotId: string | null, commentId: string | null) => void
  id: string
}) {
  
  const [disabled, setDisabled] = useState(false)
  const [tag, setTag] = useState<string[] | null>([])

  const contentSpan = useRef<HTMLSpanElement>(null)
  const contentTextarea = useRef<HTMLTextAreaElement>(null)
  const [message, setMessage] = useState<string>(props.comment.commentContent);

  // const emit = defineEmits(['deleteComments', 'editComments','chooseBlock'])
  const deleteThis = () => {
    props.deleteComments(props.comment.commentId)
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
      props.editComments(props.comment.commentId, message)
    }
  }, [disabled])

  useEffect(() => {
    const helper = async () => {
      setTag(await getCommentTag(props.comment.commentId))
    }
    setDisabled(true)
    helper()
  }, [])

  return (
      <div 
        className="SingleMargin"
        id={props.id}
        onClick={() => props.chooseBlock(null, props.id)}
      >
        <div className="SingleMargin margin-item">
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
            <div className="tags">
              {tag?.map(it => 
                <div className="tag" key={it}>
                  <span>{it}</span>
                </div>
              )}
            </div>
        </div>
        <button className="SingleMargin delete" onClick={deleteThis}>删除</button>
        <button className="SingleMargin edit" onClick={editThis}>编辑</button>
        {/* <button className="SingleMargin add-answer" onClick={addAnswer}>添加关联</button> */}
      </div>
    </div>
  )
}