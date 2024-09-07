<script setup>
import { defineProps } from 'vue';

const props = defineProps({
  pic: '',
  name: ''
})
</script>

<template>
  <div class="grid">
    <div class="wrapper">
      <img :src="props.pic" alt="test">
      <div class="bottom-bar">
        <span class="text">{{props.name}}</span>
        <div class="underline"></div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../assets/base.scss';

.grid{
  list-style: none;
  height: vh(250);
  width: vw(320);
  position: relative;
}

.grid .wrapper{
  height: vh(250);
  width: vw(180);
  position: relative;
}

.grid .wrapper img{
  position: absolute;
  top: vh(35);
  right: 0px;
  height: vh(180);
  width: vw(180);
}

.grid .bottom-bar{
  position: absolute;
  bottom: vh(35);
  left: 0px;
  height: vh(50);
  width: 100%;
  background-color: black;
}

.grid .bottom-bar .underline{
  position: absolute;
  height: 1px;
  width: 100%;
  top: 50%;
  background-color: #fff;
}

.grid .bottom-bar .text{
  position: absolute;
  top: 0px;
  left: 0px;
  font-family: 'Han Sans SC';
  font-weight: 900;
  line-height: vh(18);
  font-size: vh(18);
  color: white;
  height: vh(18);
  width: vw(300);
  top: vh(3.67);
  left: vw(10.67);
}

</style>