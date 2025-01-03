"use client";

import useUserStore from "@/app/store/login";
import { addComments, deleteComments, editComments, getCommentCount, getPlotCount, listComments, listPlots } from "@/utils/api";
import { Plot, Comment } from "@/utils/dataTypes";
import { useParams, usePathname} from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import SingleDialog from "./SingleDialog/page"
import SingleMargin from "./SingleMargin/page"
// import SingleOutcome from "./SingleDialog/page"
import SingleChoice from "./SingleChoice/page"
import { Pagination } from "antd";
import "./ReadPage.scss"


export default function Page() {
  // const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{chapter: string, story: string}>()
  const [storyType, setStoryType] = useState<string>("")
  const chapter = decodeURI(params.chapter)
  const story = decodeURI(params.story)

  const store = useUserStore()
  // console.log(store)

  // 这里所有带chosen的是表示选中元素的各种属性
  const [chosenDialog, setChosenDialog] = useState<string>("") // 当前正在阅读的dialog
  const [chosenMargin, setChosenMargin] = useState<string>("") // 当前正在阅读的margin
  const [chosenDialogPage,] = useState<number>(1)
  const [chosenMarginPage,] = useState<number>(1)
  const [chosenDialogPageSize,] = useState<number>(1)
  const [chosenMarginPageSize,] = useState<number>(10)
  const [plots, setPlots] = useState<Plot[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const marginRef = useRef<HTMLDivElement>(null)

  // 这些是实际渲染用的属性
  const [commentPageNum, setCommentPageNum] = useState<number>(1)
  const [commentPageSize, setCommentPageSize] = useState<number>(10)
  const [plotPageNum, setPlotPageNum] = useState<number>(1)
  const [plotPageSize, setPlotPageSize] = useState<number>(10)

  const [plotNum, setPlotNum] = useState<number>(0); 
  const [commentNum, setCommentNum] = useState<number>(0);

  // const displayPlots = ref(true) // 仅仅是为了让v-for更新
  // const displayComments = ref(true) // 仅仅是为了让v-for更新


  // 监听所有选中对话
  useEffect(() => {
    if (contentRef.current != null && chosenDialog != "") {
      const obj = contentRef.current.querySelector(`#${chosenDialog}`)
      // console.log(obj)
      if (obj != null) {
        obj.classList.add("chosen")
      }
    }
  }, [chosenDialog, plots])

  useEffect(() => {
    if (marginRef.current != null && chosenMargin != "") {
      const obj = marginRef.current.querySelector(`#${chosenMargin}`)
      // console.log(obj)
      if (obj != null) {
        obj.classList.add("chosen")
      }
    }
  }, [chosenMargin, comments])

  // 默认前提条件: 已经登录,不然应该直接被踢出去
  const refreshComments = async () => {
    // displayComments = false
    // console.log(store)
    if (store.user == null || store.user?.name == null) {
      return
    }
    // console.log(store)
    const res = await listComments(story, chapter, store.user!.name!, commentPageSize, commentPageNum)
    // console.log(res)
    setComments(res)
    setCommentNum(await getCommentCount(story, chapter))
    // chosenMarginPage = commentPageNum
    // chosenMarginPageSize = commentPageSize
    // displayComments = true
    // await nextTick()
  }

  const refreshPlots = async () => {
    // displayPlots = false
    // console.log(plotPageNum, plotPageSize)
    const res = await listPlots(story, chapter, plotPageSize, plotPageNum)
    setPlots(res)
    setPlotNum(await getPlotCount(story, chapter))
    // chosenDialogPage = plotPageNum
    // chosenDialogPageSize = plotPageSize
    // displayPlots = true
    // await nextTick()
    // console.log(contentRef)
  }

  useEffect(() => {
    if (pathname.startsWith("/navigate/MainStory")) {
      // console.log("set")
      setStoryType("主线");
      // console.log(type);
    } else if (pathname.startsWith("/navigate/SideStory")) {
      setStoryType("支线");
    } else if (pathname.startsWith("/navigate/Collections")) {
      setStoryType("故事集")
    } else if (pathname.startsWith("/navigate/Special")) {
      setStoryType("特殊")
    } else if (pathname.startsWith("/navigate/RougeLike")) {
      setStoryType("肉鸽")
    }
  }, [pathname])

  // 初始化的时候,更新所有对话和批注, 并额外监听翻页事件
  useEffect(() => {
    const helper = async () => {
      // console.log(contentRef)
      await refreshPlots()
    }
    helper()
  }, [plotPageNum, plotPageSize])

  useEffect(() => {
    const helper = async () => {
      await refreshComments()
    }
    helper()
  }, [store.user, commentPageNum, commentPageSize])

  const countPrecedingChoices = (currentIndex: number) => {
    return plots.slice(0, currentIndex).filter(item => item.dialogType === '选择').length + 1;
  };

  // 移除所有.chosen类,并把chosen加入选中元素的classList
  const chooseBlock = (plotid: string | null, commentid: string | null) => {
    console.log(plotid, commentid)
    if (plotid != null) {
      contentRef.current?.querySelectorAll(".chosen").forEach(it => {
        it.classList.remove("chosen")
      })
      contentRef.current?.querySelector(`#${plotid}`)?.classList.add("chosen")
      setChosenDialog(plotid)
    }
    if (commentid != null) {
      marginRef.current?.querySelectorAll(".chosen").forEach(it => {
        it.classList.remove("chosen")
      })
      marginRef.current?.querySelector(`#${commentid}`)?.classList.add("chosen")
      setChosenMargin(commentid)
    }
  }

  // 跳转至当前批注和当前对话
  const jumpToPlace = async () => {
    if (chosenDialog != "") {
      setPlotPageNum(chosenDialogPage)
      setPlotPageSize(chosenDialogPageSize)
      // console.log(plotPageNum, plotPageSize)
      await refreshPlots()
      contentRef.current?.querySelector(`#${chosenDialog}`)?.scrollIntoView({ behavior: 'smooth' });
    }
    if (chosenMargin != "") {
      setCommentPageNum(chosenMarginPage)
      setCommentPageSize(chosenMarginPageSize)
      await refreshComments()
      contentRef.current?.querySelector(`#${chosenMargin}`)?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // const pushIntoComments = (dialogId: number, choiceId: number, outcomeId: number, story: string, chapter: string, username: string, commentContent: string, storyType: string) => {
  //   comments.push({
  //     dialogId: dialogId,
  //     choiceId: choiceId,        
  //     outcomeId: outcomeId,
  //     story: story,
  //     chapter: chapter,
  //     username: store.username,
  //     commentContent: commentContent,
  //     storyType: storyType
  //   } as Comment)
  // }

  const clickAddComment = async () => {
    // 进行插入或者删除操作后只在页面上更新,之后用户刷新页面的时候再从数据库拉取数据
    if (chosenDialog.startsWith("dialog")) {
      await addComments({
        dialogId: parseInt(chosenDialog.replace("dialog","")), 
        story: story, 
        chapter: chapter, 
        username: store.user?.name, 
        commentContent: "", 
        storyType: storyType
      } as Comment)
      await refreshComments()
      // pushIntoComments(chosenDialog.replace("dialog",""), null, null, story, chapter, username, "", storyType)
      return
    }
    else if (chosenDialog.startsWith("choice")) {
      const choiceId = parseInt(chosenDialog.split("-")[0].replace("choice",""))
      if (chosenDialog.includes("outcome")) {
        const outcomeId = parseInt(chosenDialog.split("-")[1].replace("outcome",""))
        await addComments({
          choiceId: choiceId,
          outcomeId: outcomeId, 
          story: story, 
          chapter: chapter, 
          username: store.user?.name, 
          commentContent: "", 
          storyType: storyType
        } as Comment)
        await refreshComments()
        return
      }
      await addComments({
        choiceId: choiceId,
        story: story, 
        chapter: chapter, 
        username: store.user?.name, 
        commentContent: "", 
        storyType: storyType
      } as Comment)
      await refreshComments()
      // pushIntoComments(null, decisionId, null, story, chapter, username, "", storyType)
    }
  }

  const deleteComment = async (commentId: number) => {
    await deleteComments(commentId)
    await refreshComments()
    // comments = comments.filter (it => it.commentId != commentId)
  }

  const editComment = async (commentId: number, commentContent: string) => {
    console.log(commentId, commentContent)
    await editComments(commentId, commentContent)
    await refreshComments()
  }

  const onDialogPageChange = (currentPage: number, size: number) => {
    console.log("onDialogChange")
    setPlotPageNum(currentPage);
    setPlotPageSize(size);
  }

  const onMarginPageChange = (currentPage: number, size: number) => {
    setCommentPageNum(currentPage);
    setCommentPageSize(size);
  }

  return (
    <div className="ReadPage read-page" onClick={() => console.log("read-page")}>
      <Image src={"/assets/pics/阅读页.png"} className="ReadPage background" alt="test" width={0} height={0}/>
      <div className="ReadPage content-wrapper" onClick={() => console.log("content-wrapper")}>
        <button className="ReadPage new-margin" onClick={() => clickAddComment()}>新建批注</button>
        <button className="ReadPage jump-to-place" onClick={() => jumpToPlace()}>跳转</button>
        <span className="ReadPage title">{story+'/'+chapter}</span>
        <span className="ReadPage decoration">PLOTS</span>
        <div className="ReadPage content" ref={contentRef} onClick={() => console.log("contentRef")}>
          {plots.map((item, index) => {
            return item.dialogType === '选择' ? (
              <SingleChoice
                key={index}
                id={`choice${countPrecedingChoices(index)}`}
                plot={item}
                decisionId={countPrecedingChoices(index)}
                chooseBlock={chooseBlock}
              />
            ) : (
              <SingleDialog
                key={index}  // Ensure each child has a unique key
                id={`dialog${item.dialogId}`}
                plot={item}
                chooseBlock={chooseBlock}
              />
            );
          })}
        </div>
        <div className="ReadPage pagination">
          <Pagination
            showQuickJumper
            showSizeChanger
            showTotal={() => `${plotNum}条数据`}
            current={plotPageNum}
            pageSize={plotPageSize}
            pageSizeOptions={[10,20,50]}
            size="small"
            total={plotNum}
            onChange={onDialogPageChange}
            onShowSizeChange={onDialogPageChange}
          />
        </div>
    </div>
      <div className="ReadPage margin-wrapper">
        <span className="ReadPage title">批注</span>
        <span className="ReadPage decoration">BOOKMARKS</span>
        <div className="ReadPage margin" ref={marginRef}>
          {comments.map((item: Comment, index: number) => 
              <SingleMargin 
                key={index}
                comment={item}
                id={'margin'+item.commentId}
                deleteComments={deleteComment}
                editComments={editComment}
                chooseBlock={chooseBlock}>
              </SingleMargin>
            )
          }
        </div>
        <div className="ReadPage pagination">
          <Pagination
            showQuickJumper
            showSizeChanger
            showTotal={() => `${commentNum}条数据`}
            current={commentPageNum}
            pageSize={commentPageSize}
            pageSizeOptions={[10,20,50]}
            size="small"
            total={commentNum}
            onChange={onMarginPageChange}
            onShowSizeChange={onMarginPageChange}
          />
        </div>
      </div>
    </div>
  )
}