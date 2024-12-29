<script setup>
import {ref} from 'vue'
const props = defineProps({
  commentId: Number,
  dialogId: Number,
  choiceId: Number,
  story: String,
  chapter: String,
  username: String,
  commentContent: String,
  storyType: String
})

const disabled = ref(true)

const contentSpan = ref(null)
const contentTextarea = ref(null)

const emit = defineEmits(['deleteComments', 'editComments','chooseBlock'])
const deleteThis = () => {
  emit('deleteComments', props.commentId)
}

const editThis = (e) => {
  disabled.value = !disabled.value
  if (disabled.value === true){
    emit('editComments', props.commentId, contentSpan.value?.value || contentTextarea.value?.value)
  }
}
</script>

<template>
  <div class="margin-item" @click="emit('chooseBlock')">
    <div class="info">
      <span class="username-title">用户:{{props.username}}</span>
    </div>
    <div class="content" @click="emit('chooseBlock')" ref="content">
      <span
        v-if="disabled"
        class="content-item"
        ref="contentSpan"
      >
        {{props.commentContent}}
      </span>
      <textarea
        v-else
        type="text"  
        class="content-item" 
        ref="contentTextarea"
      >
      {{props.commentContent}}
      </textarea>
    </div>
    <button class="delete" @click="deleteThis">删除</button>
    <button class="edit" @click="editThis($event)">编辑</button>
    <button class="add-answer" @click="addAnswer">添加关联</button>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";
.margin-item {
  position: relative;
  left: vw(50);
  margin-top: vh(20);
  height: vh(150);
  width: vw(300);
  border: 1px solid white;
  background-color: black;
  border-radius: 20px;
}

.margin-item .info {
  position: absolute;
  left: 0px;
  top: 0px;
  height: 100%;
  width: vw(100);
  border: 1px solid white;
  border-width: 0 1px 0 0;
}

.margin-item .username-title{
  position: absolute;
  top: vh(20);
  left: vw(10);
  height: vh(20);
  width: 100%;
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(15);
  line-height: vh(15);
  word-wrap:break-word;
}

// .margin-item .type-title{
//   position: absolute;
//   top: vh(60);
//   left: vw(10);
//   height: vh(20);
//   width: 100%;
//   color: white;
//   font-family: 'Han Sans SC';
//   font-weight: 900;
//   font-size: vh(15);
//   line-height: vh(15);
//   word-wrap:break-word;
// }

.margin-item .content {
  position: absolute;
  top: vh(15);
  left: vw(110);
  height: vh(80);
  width: vw(180);
}

.margin-item .content .content-item {
  position: absolute;
  top: 0px;
  left: 0px;
  margin: 0px;
  height: 100%;
  width: 100%;
  color: white;
  font-size: vh(15);
  font-family: 'Han Sans SC';
  line-height: vh(15);
  word-wrap: break-word;
  overflow-y: scroll;
  scrollbar-width: none;
  background-color: #000;
}

.margin-item .delete {
  position: absolute;
  top: vh(100);
  left: vw(15);
  height: vh(25);
  width: vw(70);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(15);
  background-color: darkred;
  line-height: vh(15);
  border: 1px solid white;
  border-radius: 10px;
}

.margin-item .edit {
  position: absolute;
  top: vh(100);
  left: vw(115);
  height: vh(25);
  width: vw(70);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(15);
  background-color: darkred;
  line-height: vh(15);
  border: 1px solid white;
  border-radius: 10px;
}

.margin-item .add-answer {
  position: absolute;
  top: vh(90);
  left: vw(215);
  height: vh(45);
  width: vw(70);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(15);
  background-color: darkred;
  line-height: vh(15);
  border: 1px solid white;
  border-radius: 10px;
}
</style>