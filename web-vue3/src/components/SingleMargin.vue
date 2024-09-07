<script setup>
import { editComment } from '@/utils/api';
const props = defineProps({
  position: Number,
  type: String,
  content: String,
  ID: Number
})

const emit = defineEmits(['deleteComments', 'editComments'])
const deleteThis = () => {
  emit('deleteComments', props.ID)
}

const editThis = (e) => {
  e.target.parentNode.children[1].disabled = !(e.target.parentNode.children[1].disabled)
  if (e.target.parentNode.children[1].disabled === true){
    console.log("edited")
    emit('editComments', props.ID, e.target.parentNode.children[1].value)
    // editComment(props.ID, props.content, )
  }
}
</script>

<template>
  <div class="margin-item">
    <div class="info">
      <span class="position-title">位置:{{props.position}}</span>
      <span class="type-title">类型:{{props.type}}</span>
    </div>
    <textarea disabled class="content" :placeholder="props.content">{{props.content}}</textarea>
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

.margin-item .position-title{
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

.margin-item .type-title{
  position: absolute;
  top: vh(60);
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

.margin-item .content {
  position: absolute;
  top: vh(15);
  left: vw(110);
  height: vh(80);
  width: vw(180);
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