<template>
  <div class="dialog" :id="'dialog'+data.id" @click="setChosenContent(data.id)">
    <span class="role">{{data.role}}:</span>
    <span class="dialog-content">{{data.content}}</span>
  </div>
</template>

<script>
export default {
  props: {
    data: {
      type: Object,
      required: true
    }
  },
  methods: {
    setChosenContent (id) {
      this.$emit('setChosenContent', id)
    }
  }
}
</script>

<style scoped>
.dialog .role{
  border: solid 1px black;
  margin: 5px;
  width: max-content;
  position:absolute;
  left:0%;
}

.active-content{
  box-shadow:0 15px 35px rgba(0,0,0,0.5);
}

.dialog .dialog-content{
  /* border: solid 1px black; */
  /* margin: 5px; */
  width: 70;
  height: 100%;
  position:absolute;
  left:30%;
}

.dialog{
  width: 100%;;
  height: 90px;
  position: relative;
  border: solid 1px black;
  border-radius: 5px;
  overflow-x: hidden;
  margin-bottom: 10px;
}

.active-margin{
  box-shadow:0 15px 35px rgba(0,0,0,0.5);
}


</style>