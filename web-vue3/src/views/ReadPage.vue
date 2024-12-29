<script setup>
import { onMounted, ref, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { getData, getComments } from '@/utils/api';
import { addComment, deleteComments, editComments } from '@/utils/api';
import SingleDialog from '@/components/SingleDialog.vue';
import SingleMargin from '@/components/SingleMargin.vue';
import SingleChoice from '@/components/SingleChoice.vue';
import { ElPagination } from 'element-plus';
import { useLoginStore } from '@/stores/login';
const router = useRouter();
let path = router.currentRoute.value.fullPath.replace("sideStory","支线").replace("mainStory", "主线").replace("Collections","剧情").replace("special","剧情/特殊").replace("/RawHCL","沙中之火/生息演算").replace("/navigate","")
path = decodeURIComponent(path)
if (path[0] === "/"){
  path = path.substring(1)
}
const chapter = path.split('/')[path.split('/').length-1].split('.')[0].split("#")[0]
const story = path.split('/')[path.split('/').length-2]
const storyType = path.split('/')[path.split('/').length-3]

const store = useLoginStore()
// console.log(store)
const chosenDialog = ref("") // 当前正在阅读的dialog
const chosenMargin = ref ("") // 当前正在阅读的margin
const chosenDialogPage = ref(1)
const chosenMarginPage = ref(1)
const chosenDialogPageSize = ref(10)
const chosenMarginPageSize = ref(10)
const file = ref([])
const comments = ref([])
const contentRef = ref()
const marginRef = ref()

const commentPageNum = ref(1)
const commentPageSize = ref(10)

const plotPageNum = ref(1)
const plotPageSize = ref(10)

const plotNum = ref()
const commentNum = ref()

const displayPlots = ref(true) // 仅仅是为了让v-for更新
const displayComments = ref(true) // 仅仅是为了让v-for更新




const refreshComments = async () => {
  displayComments.value = false
  const res = await getComments(story, chapter, store.username, commentPageNum.value, commentPageSize.value)
  comments.value = res.list
  commentNum.value = res.total
  // chosenMarginPage.value = commentPageNum.value
  // chosenMarginPageSize.value = commentPageSize.value
  displayComments.value = true
  await nextTick()
  if (marginRef.value != null && chosenMargin.value != "") {
    const obj = marginRef.value.querySelector(`#${chosenMargin.value}`)
    // console.log(obj)
    if (obj != null) {
      obj.classList.add("chosen")
    }
  }
}

const refreshPlots = async () => {
  displayPlots.value = false
  // console.log(plotPageNum, plotPageSize)
  const res = await getData(story, chapter, plotPageNum.value, plotPageSize.value)
  file.value = res.list
  plotNum.value = res.total
  // chosenDialogPage.value = plotPageNum.value
  // chosenDialogPageSize.value = plotPageSize.value
  displayPlots.value = true
  await nextTick()
  // console.log(contentRef.value)
  if (contentRef.value != null && chosenDialog.value != "") {
    const obj = contentRef.value.querySelector(`#${chosenDialog.value}`)
    // console.log(obj)
    if (obj != null) {
      obj.classList.add("chosen")
    }
  }
}

onMounted(async () => {
  // console.log(contentRef.value)
  await refreshPlots()
  await refreshComments()
})

const countPrecedingChoices = (currentIndex) => {
  return file.value.slice(0, currentIndex).filter(item => item.dialogType === '选择').length + 1;
};

const chooseBlock = (plotid, commentid) => {
  // console.log(plotid, commentid, contentRef.value)
  if (plotid != null) {
    contentRef.value.querySelectorAll(".chosen").forEach(it => {
      it.classList.remove("chosen")
    })
    contentRef.value.querySelector(`#${plotid}`).classList.add("chosen")
    chosenDialog.value = plotid
  }
  if (commentid != null) {
    marginRef.value.querySelectorAll(".chosen").forEach(it => {
      it.classList.remove("chosen")
    })
    marginRef.value.querySelector(`#${commentid}`).classList.add("chosen")
    chosenMargin.value = commentid
  }
}

const jumpToPlace = async () => {
  if (chosenDialog.value != "") {
    plotPageNum.value = chosenDialogPage.value
    plotPageSize.value = chosenDialogPageSize.value
    // console.log(plotPageNum.value, plotPageSize.value)
    await refreshPlots()
    contentRef.value.querySelector(`#${chosenDialog.value}`).scrollIntoView({ behavior: 'smooth' });
  }
  if (chosenMargin.value != "") {
    commentPageNum.value = chosenMarginPage.value
    commentPageSize.value = chosenMarginPageSize.value
    await refreshComments()
    contentRef.value.querySelector(`#${chosenMargin.value}`).scrollIntoView({ behavior: 'smooth' });
  }
}

const pushIntoComments = (dialogId, choiceId, outcomeId, story, chapter, username, commentContent, storyType) => {
  comments.value.push({
    dialogId: dialogId,
    choiceId: choiceId,        
    outcomeId: outcomeId,
    story: story,
    chapter: chapter,
    username: store.username,
    commentContent: commentContent,
    storyType: storyType
  })
}

const clickAddComment = async () => {
  // 进行插入或者删除操作后只在页面上更新,之后用户刷新页面的时候再从数据库拉取数据
  if (chosenDialog.value.startsWith("dialog")) {
    await addComment(chosenDialog.value.replace("dialog",""), null, null, story, chapter, store.username, "", storyType)
    await refreshComments()
    // pushIntoComments(chosenDialog.replace("dialog",""), null, null, story, chapter, username, "", storyType)
    return
  }
  else if (chosenDialog.value.startsWith("choice")) {
    const decisionId = parseInt(chosenDialog.value.split("-")[0].replace("choice",""))
    if (chosenDialog.contains("outcome")) {
      const outcomeId = parseInt(chosenDialog.value.split("-")[1].replace("outcome",""))
      await addComment(null, decisionId, outcomeId, story, chapter, store.username, "", storyType)
      await refreshComments()
      return
    }
    await addComment(null, decisionId, null, story, chapter, store.username, "", storyType)
    await refreshComments()
    // pushIntoComments(null, decisionId, null, story, chapter, username, "", storyType)
  }
}

const deleteComment = async (commentId) => {
  await deleteComments(commentId)
  await refreshComments()
  // comments.value = comments.value.filter (it => it.commentId != commentId)
}

const editComment = async (commentId, commentContent) => {
  await editComments(commentId, commentContent)
  await refreshComments()
}
</script>


<template>
  <div class="read-page">
    <img src="../assets/pics/阅读页.png" class="background" alt="test">
    <div class="content-wrapper">
      <button class="new-margin" @click="clickAddComment()">新建批注</button>
      <button class="jump-to-place" @click="jumpToPlace">跳转</button>
      <span class="title">{{chapter}}</span>
      <span class="decoration">PLOTS</span>
      <div class="content" ref="contentRef" v-if="displayPlots">
        <div v-for="(item, index) in file"
          :key="index"
        >
          <SingleChoice
            v-if="item.dialogType=='选择'"
            :dialogId="item.dialogId"
            :story="item.story"
            :chapter="item.chapter"
            :dialog="item.dialog" 
            :speaker="item.speaker"
            :storyType="item.storyType"
            :decisionId="countPrecedingChoices(index)"
            :id="'choice'+countPrecedingChoices(index)"
            @chooseBlock="chooseBlock"
          >
          </SingleChoice>
          <SingleDialog 
            v-else
            :dialogId="item.dialogId"
            :story="item.story"
            :chapter="item.chapter"
            :dialog="item.dialog" 
            :speaker="item.speaker"
            :storyType="item.storyType"
            @click="chooseBlock('dialog'+item.dialogId, null)"
            :id="'dialog'+item.dialogId"
          >
          </SingleDialog>
        </div>
      </div>
      <div class="pagination">
        <el-pagination
          v-model:current-page="plotPageNum"
          v-model:page-size="plotPageSize"
          :page-sizes="[10,20,50]"
          size="small"
          :background="true"
          layout="sizes, prev, pager, next, jumper"
          :total="plotNum"
          @size-change="refreshPlots"
          @current-change="refreshPlots"
        />
      </div>
    </div>
    <div class="margin-wrapper">
      <span class="title">批注</span>
      <span class="decoration">BOOKMARKS</span>
      <div class="margin" ref="marginRef" v-if="displayComments">
        <SingleMargin 
          v-for="(item, index) in comments" 
          :commentId="item.commentId"
          :dialogId="item.dialogId"
          :choiceId="item.choiceId"
          :story="item.story"
          :chapter="item.chapter"
          :username="item.username"
          :commentContent="item.commentContent"
          :storyType="item.commentContent"
          :id="'margin'+item.commentId"
          @deleteComments="deleteComment"
          @editComments="editComment"
          @chooseBlock="chooseBlock(null,'margin'+item.commentId)">
        </SingleMargin>
      </div>
      <div class="pagination">
        <el-pagination
          v-model:current-page="commentPageNum"
          v-model:page-size="commentPageSize"
          :page-sizes="[10,20,50]"
          size="small"
          :background="true"
          layout="sizes, prev, pager, next, jumper"
          :total="commentNum"
          @size-change="refreshComments"
          @current-change="refreshComments"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";
.read-page {
  height: 100%;
  width: 100%;
  position: fixed;
  top: 0px;
  left: 0px;
  z-index: 0;
}

.new-margin {
  position: absolute;
  top: vh(30);
  left: vw(70);
  height: vh(30);
  width: vw(150);
  background-color: darkred;
  border: 1px solid white;
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(20);
  line-height: vh(20);
  border-radius: 20px;
}

.jump-to-place {
  position: absolute;
  top: vh(30);
  left: vw(250);
  height: vh(30);
  width: vw(150);
  background-color: darkred;
  border: 1px solid white;
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(20);
  line-height: vh(20);
  border-radius: 20px;
}

.save {
  position: absolute;
  top: vh(30);
  left: vw(430);
  height: vh(30);
  width: vw(150);
  background-color: darkred;
  border: 1px solid white;
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(20);
  line-height: vh(20);
  border-radius: 20px;
}


.background {
  height: 100%;
  width: 100%;
  position: absolute;
  top: 0px;
  left: 0px;
}

.content-wrapper {
  position: absolute;
  top: vh(215);
  left: vw(200);
  height: vh(800);
  width: vw(1000);
  border-radius: 20px 0px 0px 20px;
  background-color: rgba(0,0,0,0.7);
  border: 1px solid white;
}

.content-wrapper .title {
  position: absolute;
  top: vh(78);
  left: vw(70);
  width: vw(850);
  height: vh(50);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(30);
}

.content-wrapper .decoration {
  position: absolute;
  top: vh(125);
  left: vw(70);
  width: vw(850);
  height: vh(20);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(15);
}

.content-wrapper .content {
  position: absolute;
  top: vh(155);
  left: vw(70);
  height: vh(600);
  width: vw(850);
  background-color: rgba(0,0,0,0.7);
  border: 1px solid white;
  border-radius: 20px;
  overflow-y: scroll;
  scrollbar-width: none;
}

.margin-wrapper {
  position: absolute;
  top: vh(215);
  left: vw(1210);
  height: vh(800);
  width: vh(490);
  border-radius: 0px 20px 20px 0px;
  background-color: rgba(0,0,0,0.7);
  border: 1px solid white;
}

.margin-wrapper .title{
  position: absolute;
  top: vh(78);
  left: vw(45);
  width: vw(400);
  height: vh(50);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(30);
}

.margin-wrapper .decoration{
  position: absolute;
  top: vh(125);
  left: vw(45);
  width: vw(400);
  height: vh(20);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(15);
}

.margin-wrapper .margin{
  position: absolute;
  top: vh(155);
  left: vw(45);
  height: vh(600);
  width: vw(400);
  border-radius: 20px;
  border: 1px solid white;
  background-color: rgba(0,0,0,0);
  overflow-y: scroll;
  scrollbar-width: none;
}

.pagination {
  position: absolute;
  bottom: 0px;
  width: 100%;
  height: max-content;
  margin: 10px;
  justify-content: center;
}

.pagination .el-pagination {
  justify-content: center;
  position: absolute;
  height: 100%;
  width: 100%;
}

:deep(.el-pagination.is-background .el-pager li:not(.is-disabled).is-active) {
  background-color: darkred !important; //修改默认的背景色
}
</style>