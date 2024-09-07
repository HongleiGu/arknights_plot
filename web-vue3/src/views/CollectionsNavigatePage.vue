<script setup>
import { useRouter } from 'vue-router';
import SideStoryPic from '../components/SideStoryPic.vue'
// import { listFiles } from '@/utils/api';
import { CollectionsImgs } from '@/utils/imgs';
import { ref } from 'vue';
//import MainStoryPic from '../components/MainStoryPic.vue'

const router = useRouter();

const goToNav = async (item) => {
  router.push(router.currentRoute.value.fullPath + '/' + item.name)
}

const files = ref(CollectionsImgs)
console.log(files.value)

const currentItem = ref(files.value[0])
console.log(currentItem.value)

const changeItem = (item) => {
  currentItem.value = item
}

</script>

<template>
  <img class="display" :src="currentItem.cover" alt="展示" loading="eager">
  <div class="second-nav-page">
    <div class="sidebar">
      <div class="toc-wrapper">
        <div class="top-arrow">
          <img src="../assets/pics/红箭头.png" alt="向上">
        </div>
        <ul class="items">
          <SideStoryPic v-for="item in files" :pic="item.icon" :key="item.name" :name="item.name" @click="changeItem(item)"></SideStoryPic>
        </ul>
        <div class="down-arrow">
          <img src="../assets/pics/红箭头.png" alt="向上">
        </div>
      </div>
    </div>
    <div class="info">
      <div class="underline"></div>
      <span class="text-ch">{{currentItem.name}}</span>
      <span class="text-en">{{currentItem['name-en']}}</span>
      <span class="text-info">{{currentItem.info}}</span>
      <button class="jump" @click="goToNav(currentItem)">点击阅读</button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../assets/base.scss';

.second-nav-page{
  z-index: 0;
  overflow: hidden;
};
.sidebar{
  height: 100%;
  position: fixed;
  width: vw(670);
  top: 0px;
  right: 0px;
  z-index: 6;
};

.sidebar .toc-wrapper{
  height: 100%;
  position: absolute;
  top: 0px;
  right: 0px;
  width: vw(370);
  background-color: #000;
  z-index: 7;
};

.toc-wrapper .top-arrow{
  transform: rotate(180deg);
  position: absolute;
  top: vh(50);
  right: vw(70);
  height: vh(100);
  width: vw(100);
  z-index: 8;
};

.toc-wrapper .top-arrow img{
  height: 100%;
  width: 100%;
};

.toc-wrapper .down-arrow{
  position: absolute;
  bottom: vh(50);
  right: vw(70);
  height: vh(100);
  width: vw(100);
  z-index: 8;
};

.toc-wrapper .down-arrow img{
  height: 100%;
  width: 100%;
};

.items {
  height: vh(750);
  position: absolute;
  top: vh(154);
  right: vw(140);
  width: vw(320);
  overflow: scroll;
  scrollbar-width: none;
};

.display{
  position: fixed;
  top: vh(100);
  left: vw(-100);
  height: 100%;
  width: 100%;
  z-index: -1;
  opacity: 1;
};

.info {
  width: 100%;
  height: vh(200);
  background-color: rgba(0,0,0,0.5);
  position: fixed;
  top: vh(766);
};

.info .underline{
  width: vw(800);
  background-color: darkred;
  height: vh(10);
  position: absolute;
  top: 50%;
  transform: translateY(vh(5));
};

.info .text-ch{
  width: 100%;
  height: vh(50);
  position: absolute;
  top: vh(30);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  margin-left: vw(10);
  line-height: vh(50);
  font-size: vh(50);
};

.info .text-en{
  width: 100%;
  height: vh(10);
  position: absolute;
  top: 50%;
  margin-left: vw(10);
  transform: translateY(vh(-5));
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  line-height: vh(10);
  font-size: vh(10);
};

.info .text-info{
  width: vw(600);
  height: vh(100);
  position: absolute;
  top: 50%;
  left: vw(800);
  transform: translateY(vh(-5));
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  line-height: vh(10);
  font-size: vh(10);
};

.info button {
  position: absolute;
  height: vh(30);
  width: vw(60);
  background-color: darkred;
  border-radius: 10px;
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
  font-size: vh(10);
  line-height: vh(10);
  top: vh(150);
  left: vw(10);
};
</style>