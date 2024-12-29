<script setup>
const props = defineProps({
  dialogId: Number,
  story: String,
  chapter: String,
  dialog: String,
  speaker: String,
  dialog: String,
  storyType: String
})
</script>

<template>
  <div class="content-item">
    <span class="speaker">{{props.speaker}}:</span>
    <span class="dialog">{{props.dialog}}</span>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";
.content-item {
  position: relative;
  left: vw(50);
  margin-top: vh(20);
  height: vh(100);
  width: vw(750);
  border: 1px solid white;
  border-radius: 20px;
  vertical-align: middle;
  display: flex;
}

.content-item .speaker{
  position: absolute;
  left: vw(40);
  // top: vh(40);
  top:50%;
  transform:translateY(-50%);
  height: max-content;
  width: vw(150);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(15);
  line-height: vh(20);
  font-weight: 900;
  scrollbar-width: none;
  word-wrap: normal;
  word-break:normal;
  text-align: center;
}

.content-item .dialog{
  position: relative;
  left: vw(200);
  // top: vh(5);
  top:50%;
  transform:translateY(-50%);
  height: max-content;
  width: vw(500);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(20);
  line-height: vh(30);
  font-weight: 900;
  word-wrap:break-word;
}
</style>