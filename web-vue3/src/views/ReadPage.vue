<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { getData, getAllComments } from '@/utils/api';
import { save, addComment, deleteComment, editComment } from '@/utils/api';
import SingleDialog from '@/components/SingleDialog.vue';
import SingleMargin from '@/components/SingleMargin.vue';
import SelectedPart from '@/components/SelectedPart.vue';
const router = useRouter();
let path = router.currentRoute.value.fullPath.replace("sideStory","支线").replace("mainStory", "主线").replace("Collections","剧情").replace("special","剧情/特殊").replace("/RawHCL","沙中之火/生息演算").replace("/navigate","")
path = decodeURIComponent(path)
if (path[0] === "/"){
  path = path.substring(1)
}
const filename = path.split('/')[path.split('/').length-1].split('.')[0].split("#")[0]
const file = ref([])
const comments = ref([])
const refreshComments = () => {
  console.log(comments.value)
  for (let i of comments.value){
    const selectedSpan = document.querySelector(`.content-wrapper .content`).children[i.position]
    // selectedSpan.querySelectorAll("a").forEach(it => {selectedSpan.innerHTML.replace(it.innerHTML, it.innerText)})
    const selectedText = file.value[i.position].content.substring(i.start, i.end)
    selectedSpan.innerHTML = selectedSpan.innerHTML.replace(selectedText, `<a class="chosen" href="#margin${i.id}">${selectedText}</a>`)
  }
}
onMounted(async() =>{
  file.value = await getData(path)
  comments.value = await getAllComments(path)
  refreshComments()
  // comments.value = comments.value.filter(it => it)
})

const currentDialog = ref(0)
const currentMargin = ref(0)

const newComment = () => {
  const selection = window.getSelection()
  // 前提条件,只能选择一个span里的内容,多个span的话,选中的内容会出问题
  if (selection.anchorNode != selection.extentNode){
    alert("由于技术原因,本页面暂不支持跨越多个语句的选择")
    return
  }
  let start = selection.anchorOffset
  let end = selection.focusOffset
  if (end < start){
    end += start
    start = end - start
    end = end - start
  }
  const selectedText = selection.toString()
  const selectedSpan = document.querySelector(`.content #content${currentDialog.value} .dialog`)
  // selectedSpan.innerHTML = selectedSpan.innerHTML.replace(selectedText, `<span class="chosen">${selectedText}</span>`)
  console.log(comments.value.length)
  const comment = {
    "content": selectedText,
    "filename": path.replace(".txt","").replace("plot","").split("#")[0],
    "id": comments.value.length,
    "position": currentDialog.value,
    "start": start,
    "end": end
  }
  comments.value.push(comment)
  addComment(comment, path)
  refreshComments()
}

const clearSelect = () => {
  document.querySelectorAll(".dialog").forEach(it => {
    if (it.querySelector(".chosen") == null){
      return
    }
    it.innerHTML=it.innerHTML.split("<span")[0] + it.innerHTML.split(">")[1].split("<")[0] + it.innerHTML.split("</span>")[1]
  })
}

const saveFile = () => {
  save(path)
}

const deleteComments = (id) => {
  console.log("deleted")
  deleteComment(id, path)
  comments.value = comments.value.filter(it => it.id != id)
  const toBeRestored = document.querySelector(`[href="#margin${id}"]`)
  console.log(toBeRestored.parentNode.parentNode.innerHTML)
  console.log(toBeRestored.parentNode.parentNode.innerHTML.replace(toBeRestored.parentNode.innerHTML, toBeRestored.innerText))
  toBeRestored.parentNode.innerHTML = toBeRestored.parentNode.innerHTML.replace(toBeRestored.parentNode.innerHTML, toBeRestored.innerText)
  refreshComments()
}

const editComments = (id, content) => {
  editComment(id, content, path)
  console.log(content)
  console.log(id)
  comments.value.forEach(it => {
    if (it.id == id){
      it.content = content
    }
  })
  console.log(comments.value)
  refreshComments()
} 

const changeDialog = (index) => {
  console.log("changeDialog")
  currentDialog.value = index
}


const changeMargin = (index) => {
  console.log("changeMargin")
  currentMargin.value = index
}

watch(
  currentDialog,
  (newVal, oldVal) => {
    console.log(newVal)
    document.querySelectorAll(".active-dialog").forEach(it => it.classList.remove("active-dialog"))
    document.querySelectorAll(".content-item")[newVal].classList.add("active-dialog")
  }
)

watch(
  currentMargin,
  (newVal, oldVal) => {
    console.log(newVal)
    document.querySelectorAll(".active-margin").forEach(it => it.classList.remove("active-margin"))
    document.querySelectorAll(".margin-item")[newVal].classList.add("active-margin")
  }
)
</script>


<template>
  <div class="read-page">
    <img src="../assets/pics/阅读页.png" class="background" alt="test">
    <div class="content-wrapper">
      <button class="new-margin" @click="newComment()">新建批注</button>
      <button class="clear-select" @click="clearSelect()">取消选中</button>
      <button class="save" @click="saveFile()">保存批注</button>
      <span class="title">{{filename}}</span>
      <span class="decoration">PLOTS</span>
      <div class="content">
        <SingleDialog v-for="(item, index) in file" :speaker="item.role" :dialog="item.content" :key="index" :id="'content'+index" @click="changeDialog(index)"></SingleDialog>
        <SingleDialog></SingleDialog>
      </div>
    </div>
    <div class="margin-wrapper">
      <span class="title">批注</span>
      <span class="decoration">BOOKMARKS</span>
      <div class="margin">
        <SingleMargin v-for="(item, index) in comments" :position="item.position" :content="item.content" :key="'margin'+index" @click="changeMargin(index)" :ID="index" :id="'margin'+index" @deleteComments="deleteComments" @editComments="editComments"></SingleMargin>
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

.clear-select {
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
</style>