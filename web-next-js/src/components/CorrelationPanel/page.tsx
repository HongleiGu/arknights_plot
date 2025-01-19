import { Button, Col, Input, Row, Select } from "antd";
import { Comment, CorrelationCommentPair } from "@/utils/dataTypes";
import SingleMargin from "@/components/ReadPage/SingleMargin/page"
import SingleCorrelation from "@/components/CorrelationPanel/SingleCorrelation/page"
import "./page.scss"
import Image from "next/image";
import close from "/public/assets/pics/close.svg"
import { useEffect, useState } from "react";
import { deleteCorrelation, getChapter, getCorrelation, getStories } from "@/utils/api";
import { BaseOptionType, DefaultOptionType } from "antd/es/select";

export default function Page(props:{comment: Comment | null, handleClose: () => void}) {
  const [correlationCommentPairs, setCorrelationCommentPairs] = useState<CorrelationCommentPair[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [storySearch, setStorySearch] = useState<string>("")
  const [chapterSearch, setChapterSearch] = useState<string>("")
  const [stories, setStories] = useState<(BaseOptionType | DefaultOptionType)[]>([])
  const [chapters, setChapters] = useState<(BaseOptionType | DefaultOptionType)[]>([])

  useEffect(() => {
    const helper = async () => {
      console.log(props.comment?.commentId)
      if (props.comment?.commentId != null) {
        const correlation = await getCorrelation(props.comment?.commentId)
        setStorySearch(props.comment!.story)
        setChapterSearch(props.comment!.chapter)
        // const comments = await getMultipleComments(correlation.map(it => it.secondCommentId))
        console.log(correlation)
        setCorrelationCommentPairs(correlation);
      }
    }
    helper()
  }, [props.comment, props.comment?.commentId])

  useEffect(() => {
    const helper = async () => {
      setChapters(await getChapter())
    }
    helper()
  }, [])

  useEffect(() => {
    const helper = async () => {
      if (chapterSearch != "") {
        setStories(await getStories(chapterSearch))
      }
    }
    helper()
  }, [chapterSearch])
  const onDelete = async (id: number) => {
    setCorrelationCommentPairs(correlationCommentPairs.filter(it => it.correlation.correlationId != id))
    await deleteCorrelation(id)
  }
  return (
    <div className="CorrelationPanel modal">
      <div className="mainModal relative w-[100%] top-0 left-0">
        <button onClick={props.handleClose} className="absolute bg-transparent" >
					<Image
						src={close}
						alt="Close"
						width={12}
						height={12}
						className="hover:brightness-75 bg-transparent"
					/>
				</button>
        <Row className="CorrelationPanel container">
          <Col span={6}>
            <span className="title">当前批注</span>
            {props.comment != null ? 
            <SingleMargin 
              comment={props.comment}
              id={'margin'+props.comment.commentId}
            />: null}
          </Col>
          <Col span={10}>
            <span className="title">
              当前关联
            </span>
            <Row gutter={20} className="correlations">
              {correlationCommentPairs.map(it => 
                <SingleCorrelation correlationCommentPair={it} key={it.comment.commentId} onDelete={onDelete}/>
              )}
            </Row>
          </Col>
          <Col span={8}>
            <div className="title">
              所有批注
              <Row>
                <Input.Search placeholder="输入想搜索的东西" onSearch={() => console.log("")} style={{ width: '100%' }} />
              </Row>
              <Row gutter={10}>
                <Col span={3}>
                  <span>
                    故事:
                  </span>
                </Col>
                <Col span={9}>
                  <Select
                    showSearch
                    placeholder="选择故事"
                    onChange={setStorySearch}
                    onSearch={() => {}}
                    value={storySearch}
                    options={stories}  
                    style={{width: '100%'}}
                  ></Select>
                </Col>
                <Col span={3}>
                  <span>
                    章节:
                  </span>
                </Col>
                <Col span={9}>
                  <Select
                    showSearch
                    placeholder="选择章节"
                    onChange={setChapterSearch}
                    onSearch={() => {}}
                    value={chapterSearch}
                    options={chapters}
                    style={{width: '100%',color:'black'}}
                  ></Select>
                </Col>
              </Row>
            </div>
            { 
              comments.map(it =>
                <Row key={it.commentId}>
                  <Col span={16}>
                      <SingleMargin 
                        comment={it}
                        id={'margin'+it.commentId}
                      />
                  </Col>
                  <Col span={8} 
                    // className="flex justify-center items-center"
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <div className="relative">
                      <Button className="relative">+</Button>
                    </div>
                  </Col>
                </Row>
              )
            }
          </Col>
        </Row>
      </div>
    </div>
  )
}