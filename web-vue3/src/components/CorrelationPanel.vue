<script setup>
import { getAllComments } from '@/utils/api';

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

const allComments = getAllComments();
</script>

<template>
  <div class="correlation-panel">
    <div class="current-comment">
      <SingleMargin
        :commentId="props.commentId"
        :dialogId="props.dialogId"
        :choiceId="props.choiceId"
        :story="props.story"
        :chapter="props.chapter"
        :username="props.username"
        :commentContent="props.commentContent"
        :storyType="props.commentContent"
        id="currentContent">
      </SingleMargin>
    </div>
    <div class="current-correlation">

    </div>
    <div class="all-comments">
      <div class="search">

      </div>
      <div class="comments">

      </div>
    </div>
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