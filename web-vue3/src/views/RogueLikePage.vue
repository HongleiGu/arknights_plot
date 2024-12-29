<script setup>
import { RogueLikeImgs } from '@/utils/imgs';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter()

const currentItem = ref({})
const innerWidth = ref(window.innerWidth)

window.addEventListener('resize', ()=>{
  innerWidth.value = window.innerWidth
})

const selectedItem = (item, e) => {
  console.log("selected")
  // console.log(e.target)
  let target
  if (e.target.nodeName == "LI"){
    target = e.target.children[3]
  }
  else{
    target = e.target.parentNode.children[3]
  }
  console.log(target)
  currentItem.value = item
  target.classList.add("selected")
}

const unselectedItem = (item, e) => {
  currentItem.value = {'icon': ''}
  let target
  if (e.target.nodeName == "LI"){
    target = e.target.children[3]
  }
  else{
    target = e.target.parentNode.children[3]
  }
  target.classList.remove("selected")
}

const goToNav = async (item) => {
  router.push(router.currentRoute.value.fullPath + '/' + item)
}
</script>

<template>
  <div class="rouge-page">
    <div class="sidebar">
      <span class="title-en">ROGUELIKE</span>
      <span class="title-arknights">arknights</span>
    </div>
    <div class="list-wrapper">
      <ul class="list">
        <li class="list-item" v-for="item in RogueLikeImgs" @mouseover="selectedItem(item, $event)" @mouseout="unselectedItem(item, $event)" @click="goToNav(item.name)">
          <img class="image" :src="item.cover" :style="{left: -item.shift/1920*innerWidth+'px'}">
          <span class="title">{{item.name}}</span>
          <span class="title-en">{{item['name-en']}}</span>
          <span class="view-more">view more ></span>
          <div class="view-more"></div>
          <img class="icon" :src="item.icon">
        </li>
      </ul>
    </div>
    <div class="decoration">
      <span class="text">ROUGELIKE</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";

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
  height: vh(880);
  width: vw(1550);
  top: vh(200);
  left: 0px;
  background-color: black;
  overflow-x: scroll;
  scrollbar-width: none;
}

.list{
  position: absolute;
  height: vh(700);
  width: max-content;
  top: 0px;
  left: 0px;
  margin: 0px;
  padding: 0px;
  display: flex;
  flex-direction: row;
}

.list-item{
  position: relative;
  height: 100%;
  width: vw(387.5);
  border: 1px solid white;
  top: 0px;
  overflow: hidden;
}

.list .image{
  height: 100%;
  // left: vw(-400);
  position: absolute;
  top: 0px;
}

.list .icon{
  z-index: 100;
  position: absolute
}

.list .title{
  height: vh(65);
  width: vw(300);
  color: white;
  font-weight: 900;
  font-size: vh(30);
  position: absolute;
  top: vh(500);
  left: vw(80);
}

.list .title-en{
  height: vh(20);
  width: vw(300);
  color: white;
  font-weight: 900;
  font-size: vh(15);
  position: absolute;
  top: vh(550);
  left: vw(80);
}

.list .view-more{
  height: vh(20);
  width: vw(200);
  color: white;
  font-weight: 900;
  font-size: vh(15);
  position: absolute;
  top: vh(600);
  left: vw(80);
}

.list .view-more{
  height: vh(20);
  width: vw(200);
  color: white;
  font-weight: 900;
  font-size: vh(15);
  position: absolute;
  top: vh(600);
  left: vw(80);
  border-bottom: 1px solid white;
}

.selected {
  animation-name: selected;
  animation-duration: 5s;
  animation-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
  animation-iteration-count: 1;
  animation-play-state: running;
}

@keyframes selected {
  0% {
    left: vw(100);
  }
  100% {
    left: vw(200);
  }
}

.decoration {
  position: absolute;
  bottom: 0px;
  left: 0px;
  height: vh(180);
  width: vw(1550);
}

.decoration .text{
  position: absolute;
  bottom: 0px;
  left: 0px;
  color: rgba(0,191,255,0.3);
  font-family: 'Han Sans SC';
  height: 100%;
  width: 100%;
  font-weight: 900;
  font-size: vh(150);
}
</style>