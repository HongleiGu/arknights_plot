<script setup>
import { listFiles } from '@/utils/api.js';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const files = ref([
  { CNname : '主线', ENname: 'mainStory' },
  { CNname : '故事集', ENname: 'Collections' },
  { CNname : '支线', ENname: 'sideStory' },
  { CNname : '隐藏', ENname: 'special' },
  { CNname : '集成战略', ENname: 'RogueLike' },
  { CNname : '生息演算', ENname: 'RawHCL' },
])

const router = useRouter()

const goToNav = async (item) => {
  router.push(router.currentRoute.value.fullPath + '/' + item.ENname)
}

const selected = ref({ CNname : '主线', ENname: '' })

const selectedItem = (item, index, e) => {
  if (e.target.nodeName != "SPAN" || e.target.classList[0] != "list-items"){
    return
  }
  selected.value = files.value[index]
  e.target.classList.add("selected")
}

const unselectedItem = (item, e) => {
  selected.value = {}
  e.target.classList.remove("selected")
}
</script>

<template>
  <div class="nav-page">
    <div class="background">
      <img src="../assets/pics/石棺.png" alt="石棺">
    </div>
    <div class="sidebar">
      <span class="title-en">DATABASE</span>
      <span class="title-arknights">arknights</span>
    </div>
    <div class="list-wrapper">
      <ul class="list">
        <li class="item" v-for="(item, index) in files" :key="item.ENname" :id="item.ENname" @click="goToNav(item)" @mouseover="selectedItem(item, index, $event)" @mouseout="unselectedItem(item,$event)">
          <span class="list-items" 
            :id="item.ENname" 
            @mouseover="">{{item.CNname}}</span>
          <span class="hidden" v-show="item.ENname==selected.ENname">{{item.ENname}}</span>
        </li>
      </ul>
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
  width: vw(700);
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

.selected {
  animation-name: selected;
  animation-duration: 10s;
  animation-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);
  animation-iteration-count: 1;
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