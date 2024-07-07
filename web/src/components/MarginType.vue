<template>
  <div class="tag" ref="tag">
    <span>{{type}}</span>
    <div class="answer">
      <button @click="addAnswer" :style="'display:'+hidden">查看/添加{{answer}}</button>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    type: {
      type: String,
      required: true,
      // validator (value) {
      //   for (const i of this.availableTypes) {
      //     if (value === i){
      //       return true
      //     }
      //   }
      //   return false
      // }
    },
    hide: {
      type: Boolean,
      required: false,
      default: true
    }
  },
  mounted () {
    console.log(this.type)
    if (this.type === "推测") {
      this.$refs.tag.classList.add("inference")
      this.answer = "关联"
    } else if (this.type === "疑点") {
      this.$refs.tag.classList.add("question")
      this.answer = "解答"
    } else if (this.type === "批注") {
      this.$refs.tag.classList.add("margin")
      this.answer = "关联"
    }
  },
  data () {
    return {
      availableTypes: ['推测', '疑点', '批注'],
      answer: "解答"
    }
  },
  methods: {
    addAnswer(){
      console.log("addAnswer")
      this.$emit('displaySelectionPanel')
    }
  },
  computed: {
    hidden(){
      if (this.type === "疑点" && this.hide){
        return "hidden"
      } else {
        return "none"
      }
    }
  }
}
</script>

<style scoped>
.question {
  color: white;
  background-color: darkred;
  height: 100%;
  width: 100%;
}

.inference {
  color: white;
  background-color: #6B8E23;
  height: 100%;
  width: 100%;
}

.margin {
  color: white;
  background-color: #6495ED;
  height: 100%;
  width: 100%;
}
</style>