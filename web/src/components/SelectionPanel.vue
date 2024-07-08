<template>
  <div class="selectionPanel">
    <div class="wrapper">
      <button class="close" @click="toggle">X</button>
      <div class="modal-content">
        <div class="modal-content-left modal-div">
          <div class="title"><span>当前批注</span></div>
          <single-margin 
            :data="currentData" 
            :type="currentData.type" 
            @setChosenMargin="nothing" 
            @edit="nothing" 
            @deleteComments="nothing"
            :key="currentData.id"
            >
          </single-margin>
        </div>
        <div class="modal-content-middle modal-div">
          <div class="title"><span>所有批注</span></div>
          <comments @add="add"></comments>
        </div>
        <div class="modal-content-right modal-div">
          <div class="title"><span>有关联的批注</span></div>
          <div class="comment-list">
            <ul>
                <div v-for="(data, index) in temp_comments" :key="index" class="comment-wrapper" :id="'comment'+index" ref="margin">
                    <span>{{data.filename}}:</span>
                    <single-margin :data="data" :type="data.type" @setChosenMargin="nothing" @edit="notAlter" @deleteComments="deleteAnswer(data)" :filename="data.filename"></single-margin>
                </div>
            </ul>
          </div>  
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import SingleMargin from './SingleMargin.vue'
import Comments from '@/views/Comments.vue'
import axios from 'axios'
export default {
  props:{
    currentData: {
      type: Object,
      required: true
    }
  },
  async created() {
    await axios({
      url: this.$store.state.url + "/get_answer",
      params: {
          target_filename: this.currentData.filename,
          target_id: this.currentData.id,
      }
    }).then(
      res => (this.temp_comments = res.data)
    )
  },
  methods: {
    toggle() {
      this.$emit("showSelectionModal")
    },
    nothing(){
      return
    },
    notAlter(){
      alert("not supported in this panel")
    },
    async deleteAnswer(data){
      await axios({
        url: this.$store.state.url + "/delete_answer",
        params: {
          target_filename: this.currentData.filename,
          target_id: this.currentData.id,
          answer_filename: data.filename,
          answer_id: data.id
        }
      })
      this.temp_comments = this.temp_comments.filter(res => (res.filename != data.filename && res.id != data.id))
      await axios({
        url: this.$store.state.url + "/get_answer",
        params: {
            target_filename: this.currentData.filename,
            target_id: this.currentData.id,
        }
      }).then(
        res => (this.temp_comments = res.data)
      )
    },
    async add(filename1, id1){
      console.log(filename1)
      if (filename1 === "" || id1 === -1){
        console.log("answer not valid")
        return
      }
      await axios({
        url: this.$store.state.url + "/add_answer",
        params: {
          target_filename: this.currentData.filename,
          target_id: this.currentData.id,
          answer_filename: filename1,
          answer_id: id1
        }
      })
      await axios({
        url: this.$store.state.url + "/get_answer",
        params: {
            target_filename: this.currentData.filename,
            target_id: this.currentData.id,
        }
      }).then(
        res => (this.temp_comments = res.data)
      )
    }
  },
  components: {
    'singleMargin': SingleMargin,
    'comments': Comments
  },
  data(){
    return {
      temp_comments: []
    }
  }
}
</script>

<style scoped>
.selectionPanel{
  position: fixed;
  height: 100%;
  width: 100%;
  background-color: rgba(0,0,0,0.5);
  top:0%;
  left:0%;
}

.wrapper{
  position: absolute;
  left: 50%;
  transform: translate(-600px, -400px);
  top: 50%;
  height: 800px;
  width: 1200px;
  border-radius: 10px;
  background-color: #fff;
  border: solid 1px black;
}

.wrapper .close{
  position: absolute;
  left: 0%;
  top: 0%;
  margin: 10px;
  height: 40px;
  width: max-content;
}

.wrapper .modal-content{
  position: absolute;
  top: 60px;
  width: 100%;
  height: 740px;
  display: flex;
  flex-direction:row;
  justify-content: space-between;
}

.wrapper .modal-content .modal-div{
  height: 100%;
  width: 30%;
  border: solid 1px black;
}

.wrapper .modal-content .modal-div .comments{
  height: 100%;
  width: 100%;
}

.modal-content-right{
  overflow-y: scroll;
}
</style>