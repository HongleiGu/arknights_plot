<script setup>
import { listFiles } from '@/utils/api.js';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { mainStoryImgs } from '@/utils/imgs';

const router = useRouter()

const goToNav = async (item) => {
  router.push(router.currentRoute.value.fullPath + '/' + item)
}
const currentItem = ref(mainStoryImgs[0])

onMounted(() => {
  const float = document.querySelector(".float")
  window.addEventListener('mousemove', (e) => {
    float.style.left = e.pageX + 'px'
    float.style.top = e.pageY + 'px'
  })
})


const selectedItem = (item, e) => {
  if (e.target.nodeName != "SPAN" || e.target.classList[0] != "list-items"){
    return
  }
  currentItem.value = item
  e.target.classList.add("selected")
}

const unselectedItem = (item, e) => {
  currentItem.value = {'icon': ''}
  e.target.classList.remove("selected")
}
</script>

<template>
  <div class="nav-page">
    <div class="float" ref="float">
      <img :src="currentItem.icon" alt="icon" v-show="currentItem.icon != ''">
    </div>
    <div class="background">
      <img src="../assets/pics/石棺.png" alt="石棺">
    </div>
    <div class="sidebar">
      <span class="title-en">MAIN STORIES</span>
      <span class="title-arknights">arknights</span>
    </div>
    <div class="list-wrapper">
      <ul class="list">
        <li class="item" v-for="item in mainStoryImgs" :key="item.name" @mouseover="selectedItem(item, $event)" @mouseout="unselectedItem(item, $event)" :style="{ cursor:'url('+currentItem.icon+')' }">
          <span class="list-items" @click="goToNav(item.name)">{{item.name}}</span>
          <span class="hidden" v-show="currentItem.name==item.name">{{item['name-en']}}</span>
        </li>
        <li class="item">
        </li>
      </ul>
    </div>
    <div class="cover">
      <img :src="currentItem.cover" alt="test">
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../assets/base.scss';

.nav-page {
  height: 100%;
  width: 100%;
}

.background {
  height: 100%;
  width: 100%;
  position: fixed;
  top: 0px;
  left: 0px;
}

.background img {
  height: 100%;
  width: 100%;
}

.sidebar{
  height: 100%;
  width: vw(370);
  position: absolute;
  right: 0px;
  background-color: black;
  border: 1px solid white;
  z-index: 6;
}

.sidebar .title-en{
  font-family: 'Han Sans SC';
  color: white;
  font-size:vh(40);
  font-weight: 900;
  position: absolute;
  top: vh(650);
  left: vw(100);
  height: vh(40);
  width: vw(250);
  text-align: right;
  z-index: 7;
  line-height: vh(40);
}

.sidebar .title-arknights{
  font-family: 'Han Sans SC';
  color: white;
  font-size:vh(20);
  font-weight: 400;
  position: absolute;
  top: vh(620);
  left: vw(100);
  height: vh(40);
  width: vw(250);
  text-align: right;
  z-index: 7;
  line-height: vh(20);
}

.sidebar .icon{
  position: absolute;
  top: vh(600);
  left: vw(20);
  height: vh(96);
  width: vw(96);
  z-index: 6;
}

.list-wrapper {
  position: absolute;
  top: vh(200);
  left: 0px;
  height: vh(800);
  width: vw(1500);
  margin-left: vw(25);
  margin-right: vw(25);
  overflow-y: scroll;
  scrollbar-width: none;
}

.list-wrapper .list{
  height: max-content;
  width: 100%;
  position:absolute;
  top: 0px;
  left: 0px;
  padding: 0px;
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.list-wrapper .list .item{
  width: vw(1450);
  height: vh(100);
  margin-top: vh(20);
  margin-bottom: vh(20);
  margin-left: vw(25);
  margin-right: vw(25);
  position: relative;
}

.list .item .list-items {
  color: white;
  border-bottom: 1px solid white;
  z-index: 8;
  position: absolute;
  height: vh(60);
  width: vw(600);
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(50);
  line-height: vh(60);
  left: vw(100);
  top: vh(40);
}

.list .item .hidden {
  color: rgba(0,191,255,0.5);
  position: absolute;
  text-align: right;
  height: vh(80);
  width: vw(700);
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(80);
  line-height: vh(80);
  left: vw(100);
  top: vh(10);
}

.list .item .item-logo {
  position: absolute;
  top: 0px;
  left: 0px;
  height: vh(100);
}
.cover {
  height: vw(640);
  width: vw(640);
  position: absolute;
  top: vh(360);
  left: vw(835);
  vertical-align: middle;
  align-items: center;
  display: flex;
}

.cover img{
  width: vw(640);
  position: absolute;
  left: 0px;
}

.float {
  height: vh(256);
  width: vw(256);
  position: absolute;
  z-index: 10;
}

.float img {
  height: 100%;
  width: 100%;
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 9;
  opacity: 0.9;
}
.selected {
  animation-name: selected;
  animation-duration: 10s;
  animation-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
  animation-iteration-count: 1;
  animation-play-state: running;
}

@keyframes selected {
  0% {
    left: vw(100);
  }
  100% {
    left: vw(300);
  }
}
</style>