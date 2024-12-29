<script setup>
import { useRouter } from 'vue-router';
import { imgs, specialImg, RawHCLImgs } from '@/utils/imgs';
import { ref, onMounted } from 'vue';
import { listFiles } from '@/utils/api';

const router = useRouter();

const currentStory = router.currentRoute.value.params.story
const currentItem = ref({})

console.log(decodeURI(router.currentRoute.value.fullPath))
if (router.currentRoute.value.fullPath == "/navigate/special"){
  currentItem.value = specialImg[0]
}
else if (router.currentRoute.value.fullPath == "/navigate/RawHCL"){
  currentItem.value = RawHCLImgs[0]
} else {
  for (let i of imgs){
    if (i.name == currentStory){
      currentItem.value = i
      break
    }
  }
}

const goToNav = async (item) => {
  router.push(decodeURI(router.currentRoute.value.fullPath) + '/' + item)
}

const files = ref([])
let backupFiles = []
onMounted(async () => {
  files.value = await listFiles(decodeURI(router.currentRoute.value.fullPath).replace("sideStory","支线").replace("mainStory", "主线").replace("special","特殊").replace("Collections","剧情").replace("RawHCL","生息演算").replace("RogueLike","集成战略").replace("/navigate",""))
  console.log(files.value)
  const file = []
  for (let k of Object.keys(files.value)) {
    console.log(k, files.value[k])
    if (files.value[k] === "file") {
      file.push(k);
    }
  }
  files.value = file.sort((a,b) => parseInt(a.split("_")[0]) - parseInt(b.split("_")[0]))
  files.value = files.value.map(it => it.substring(it.indexOf("_")+1).split(".txt")[0])
  backupFiles = files.value
})


</script>

<template>
  <div class="second-nav-page">
    <div class="sidebar">
      <span class="title">{{currentItem.name}}</span>
      <span class="info">{{currentItem.info}}</span>
      <div class="list">
        <div class="wrapper">
          <div class="item" v-for="(item, index) in files" :key="index" @click="goToNav(files[index])">
            <!-- <span class="title">{{index+1}}</span> -->
            <span class="name">{{item}}</span>
          </div>
        </div>
      </div>
      <button @click="goToNav(files[0].filename)">开始阅读</button>
    </div>
    <div class="background">
      <img :src="currentItem.cover" alt="test">
    </div>
    <div class="shade-background">
      <img :src="currentItem.cover" alt="test">
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../assets/base.scss';

.second-nav-page{
  z-index: 0;
  overflow: hidden;
  height: 100%;
  width: 100%;
  padding: 0px;
  margin: 0px;
  border: 0px;
  position: fixed;
  top: 0px;
  left: 0px;
  background-color: black;
};
.sidebar{
  height: 100%;
  position: fixed;
  width: vw(670);
  top: 0px;
  right: 0px;
  z-index: 6;
  background-color: black;
  border: 1px solid white;
};

.sidebar .title{
  height: vh(60);
  width: vw(600);
  line-height: vh(60);
  font-size: vh(60);
  font-family: 'Han Sans SC';
  color: white;
  position:absolute;
  top: vh(200);
  font-weight: 900;
  left: vw(70);
}

.sidebar .info{
  height: vh(60);
  width: vw(530);
  line-height: vh(10);
  font-size: vh(10);
  font-family: 'Han Sans SC';
  color: white;
  position:absolute;
  top: vh(300);
  font-weight: 900;
  left: vw(70);
}

.sidebar .list{
  height: vh(500);
  width: vw(530);
  position: absolute;
  border: 1px solid white;
  top: vh(400);
  left: vw(70);
  border-radius: 10px;
  display: flex;
  // flex-direction: row;
  // align-items:start;
  flex-wrap: wrap;
  list-style-type: none;
  overflow: scroll;
  scrollbar-width: none;
}


.list .wrapper{
  height: max-content;
  width: 100%;
  margin-left: vw(10);
  display: flex;
  flex-wrap:wrap;
  align-items: flex-start;
  overflow: scroll;
  scrollbar-width: none;
}

.sidebar button{
  height: vh(24);
  width: vw(80);
  background-color: darkred;
  border-radius: 10px;
  position: absolute;
  top: vh(950);
  right: vw(40);
  color: white;
  font-family: 'Han Sans SC';
  font-weight: 900;
}

.list .item{
  height: vh(30);
  width: vw(240);
  margin-top: vh(10);
  margin-right: vw(15);
  border: 1px solid white;
  border-radius: 10px;
  position: relative;
  // flex-basis: vh(10);
}

.item .title{
  height: vh(30);
  width: vw(40);
  font-family: 'Han Sans SC';
  font-size: vh(25);
  position: absolute;
  font-weight: 400;
  top: 0px;
  left: 0px;
  line-height: vh(30);
  color: white;
}

.item .name{
  height: vh(30);
  width: vw(200);
  color: white;
  font-family: 'Han Sans SC';
  font-size: vh(15);
  position: absolute;
  top: 0px;
  line-height: vh(30);
  left: vw(10);
  overflow: scroll;
  scrollbar-width: none;
  white-space: nowrap;
  word-wrap: none;
}

.background {
  width: vw(1240);
  height: vh(715);
  background-color: darkred;
  position: fixed;
  top: vh(182.5);
}

.background img{
  width: vw(1200);
  height: vh(675);
  position: absolute;
  top: vh(30);
  left: vw(20);
}

.shade-background{
  height: 200%;
  width: 200%;
  position: fixed;
  left: -50%;
  top: -50%;
  opacity: 0.1;
}

.shade-background img{
  height: 100%;
  width: 100%;
}
</style>