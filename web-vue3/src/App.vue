<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header>
    <div class="img-wrapper">
      <img src="./assets/pics/babel_logo.png" alt="babel logo">
    </div>
    <div class="router-link-wrapper">
      <RouterLink to="/home" class="routerlink">
        <div class="routerlink-inner-wrapper">
          <p class="routerlink-en">HOME</p>
          <p class="routerlink-ch">首页</p>
        </div>
      </RouterLink>
      <RouterLink to="/navigate" class="routerlink">
        <div class="routerlink-inner-wrapper">
          <p class="routerlink-en">NAVIGATE</p>
          <p class="routerlink-ch">导航页</p>
        </div>
      </RouterLink>
      <RouterLink to="/home" class="routerlink">
        <div class="routerlink-inner-wrapper">
          <p class="routerlink-en">DOCUMENT</p>
          <p class="routerlink-ch">文档页</p>
        </div>
      </RouterLink>
      <RouterLink to="/home" class="routerlink">
        <div class="routerlink-inner-wrapper">
          <p class="routerlink-en">EXTRA</p>
          <p class="routerlink-ch">扩展</p>
        </div>
      </RouterLink>
    </div>
  </header>
  <RouterView class="routerview"/>
</template>

<style lang="scss" scoped>
@import './assets/base.scss';
header {
  width: vw(1920);
  height: vh(200);
  position: fixed;
  top: 0px;
  left: 0px;
  background-color: black;
  z-index: 1;
};

.img-wrapper {
  width: vw(100);
  height: vh(100);
  position: absolute;
  top: 50px;
  left: 50px;
};

.img-wrapper img {
  height: 100%;
  width: 100%;
  position: absolute;
};

.router-link-wrapper {
  position: absolute;
  top: vh(50);
  left: vw(350);
  height: vh(100);
  width: vw(1200);
  display: flex;
  flex-direction: row;
  border-left: 1px solid white;
};

.router-link-wrapper .routerlink {
  height: 100%;
  width: 25%;
  border-right: 1px solid white;
};

.router-link-wrapper .routerlink .routerlink-inner-wrapper{
  height: 100%;
  width: 25%;
  position:absolute;
  top: 0px;
};

.router-link-wrapper .routerlink .routerlink-inner-wrapper .routerlink-en{
  height: vh(50);
  width: vw(208.5);
  color: white;
  font-family: 'Noto Sans SC';
  font-weight: 900;
  line-height: vh(50);
  font-size: vh(50);
  position: absolute;
  top: 0px;
  margin: 0px;
  letter-spacing: -8px;
}

.router-link-wrapper .routerlink .routerlink-inner-wrapper .routerlink-ch{
  height: vh(41);
  width: vw(97.5);
  color: white;
  font-family: 'Noto Sans';
  font-weight:900;
  line-height: vh(20);
  font-size: vh(20);
  position: absolute;
  bottom: 0px;
  margin: 0px;
  letter-spacing: 0px;
}

.routerview{
  position:fixed;
  height: 100%;
  width: 100%;
  top: 0px;
  left: 0px;
}
</style>