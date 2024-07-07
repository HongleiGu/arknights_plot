<template>
  <div id="app">
    <div class="footer">
      <!-- <a href="#/friend">friend</a>
      <a href="#/find">find</a>
      <a href="#/my">my</a> -->
      <router-link to="/home">首页</router-link>
      <router-link to="/navigate/">导航页</router-link>
      <router-link to="/search/">搜索页</router-link>
      <router-link to="/comments/">所有批注</router-link>
      <!-- <router-link to="/find/1">find1</router-link> -->
      <!-- <router-link to="/my">my</router-link> -->
    </div>
    <div class="top">
      <router-view :key="$route.fullPath"></router-view>
    </div>
  </div>
</template>

<script>
// import HelloWorld from './components/HelloWorld.vue'

export default {
  name: 'App',
  components: {
    // HelloWorld
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  height: 1000px;
}
.footer {
  display: flex;
  flex-direction: row;
  justify-content:left;
  margin: auto 0;
  position: fixed;
}
.footer a {
  height: 80px;
  width: 160px;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 20px;
  text-align: center;
  vertical-align: middle;
  margin:0px;
  border: 2px solid black;
  font-weight: 100;
  text-decoration:none;
  line-height: 80px;
  margin-left: 10px;
}
.footer .link-active{ /*这里是模糊匹配*/
  background-color: darkred;
}
.top{
  position: absolute;
  top: 10%;
  height: 85%;
  width: 100%;
}

</style>
