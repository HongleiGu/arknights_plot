<script setup>
import router from '@/router';
import { onMounted } from 'vue'

onMounted(() => {
    const background = document.querySelector(".background")
    background.addEventListener("scroll",()=>{
      console.log(background.scrollTop)
      console.log(window.innerHeight)
      if (background.scrollTop >= window.innerHeight){
        router.push("/navigate")
      }
    })
  }
)
</script>

<template>
  <div class="HomePage">
    <div class="background">
      <p></p>
    </div>
    <div class="enter">
      <img src="../assets/pics/活动图标_巴别塔.png" alt="图标" class="icon">
      <div class="arrow-wrapper">
        <img src="../assets/pics/arrow.png" alt="箭头" class="arrow">
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../assets/base.scss';

.background {
  height: 100%;
  width: 100%;
  position: fixed;
  top: 0px;
  padding: 0px;
  margin: 0px;
  left: 0px;
  background: url('../assets/pics/首页1.png');
  background-size: vh(1080);
  overflow:scroll;
  scroll-timeline: --background;
  animation-timeline: --background;
  animation-name: openTheGate;
  animation-timing-function: linear;
  -ms-overflow-style: none;
}

.background p{
  height: 200%;
  width: 100%;
  position: absolute;
  top: 0px;
}

.enter{
  background-color: rgba(0,0,0,0.7);
  width: 100%;
  height: vh(200);
  position: absolute;
  bottom: 0px;
  border: 1px solid white;
  z-index: 3;
}

.enter .icon{
  position: absolute;
  top: 0px;
  left: vw(910);
  height: vh(100);
  width: vw(139.66);
  z-index: 3;
}

.arrow-wrapper{
  position:absolute;
  bottom: 0px;
  height: vh(110);
  width: vw(50);
  left: vw(935);
  top: vh(90);
  z-index: 2;
}

@keyframes movedown {
  from {
    top: 0px;
  }
  to {
    top: 60px;
  }
}

.arrow-wrapper .arrow{
  height: vh(50);
  width: vw(50);
  position: absolute;
  left: 0px;
  z-index: 2;
  animation-name: movedown;
  animation-duration: 1.5s;
  animation-timing-function: linear;
  animation-delay: 2s;
  animation-play-state: running;
  animation-iteration-count: infinite;
}



@keyframes openTheGate {
  0% {
    background: url('../assets/pics/首页1.png');
    background-size: cover;
  }
  100% {
    background: url('../assets/pics/首页2.png');
    background-size: cover;
  }
}

// 滚动条宽度
::-webkit-scrollbar {
  display: none;
}
</style>