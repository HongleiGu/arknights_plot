<template>
  <div class="dialog" @click="setChosenMargin(data.id)" :id="'comment'+data.id">
    <div class="info">
        <span>注释{{data.id + 1}}</span>
        <span>位置{{data.position}}</span>
        <margin-type :type="type" @displaySelectionPanel="displaySelectionPanel()">{{type}}</margin-type>
    </div>
    <textarea type="text" disabled="disabled" :value="data.content"></textarea>
    <div class="buttons">
        <button class="edit" @click="edit($event, data.id)">编辑</button>
        <button class="delete" @click="deleteComments(data.id)">删除</button>
        <a :href="this.link" class="dialog-content">跳转</a>
    </div>
  </div>
</template>

<script>
import MarginType from './MarginType.vue'
export default {
  props: {
    data: {
      type: Object,
      required: true
    },
    type: {
      type: String
    },
    filename: {
      type: String
    }
  },
  components: {
    'marginType': MarginType
  },
  methods: {
    setChosenMargin (id) {
      console.log("changed chosen margin")
      this.$emit('setChosenMargin', id)
    },
    edit(e, id) {
      e.currentTarget.parentNode.previousElementSibling.disabled = !e.currentTarget.parentNode.previousElementSibling.disabled;
      // console.log(e.currentTarget.parentNode.previousElementSibling.disabled)
      if (e.currentTarget.parentNode.previousElementSibling.disabled == true){
          // for (i in this.comments){
          //     if (this.comments[i].id == id){
          //         this.comments[i].content = e.currentTarget.parentNode.previousElementSibling.value
          //     }
          // }
        this.$emit('edit', id, e.currentTarget.parentNode.previousElementSibling.value)
      }
    },
    deleteComments(id){
      this.$emit("deleteComments", id)
    },
    displaySelectionPanel(){
      console.log("display")
      this.$emit("showSelectionModal")
    }
  },
  created () {
    if (this.filename === "" || this.filename === undefined || this.filename === null){
      this.link = this.$route.path+'#dialog'+this.data.position
    } else {
      this.link = "/search/" + this.filename +'#dialog'+this.data.position
    }
    console.log(this.link)
  },
  data () {
    return {
      link: ""
    }
  }
}
</script>

<style scoped>
.buttons{
    display: flex;
    flex-direction: row;
    justify-content: left;
}
.buttons button{
    margin: 10px;
    height: 40px;
    width: 100%;
}

.dialog textarea{
  height:100px;
  width: 90%;
  margin: 4%;
  background-color: white;
  font-weight:400;
  color: black;
  resize: none;
}

.dialog{
  width: 100%;;
  height: max-content;
  position: relative;
  border: solid 1px black;
  border-radius: 5px;
  margin-bottom: 10px;
}

.dialog .info .type{
  height: max-content;
  width: max-content;
  position: absolute;
  right: 0px;
  margin-left: 10px;
  background-color: pink;
}

.active-margin{
  box-shadow:0 15px 35px rgba(0,0,0,0.5);
}
</style>