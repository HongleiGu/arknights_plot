<template>
  <div class="navigate">
    <div class="filelist">
      <ul>
        <div class="file" v-for="filename in files" :key="filename.filename">
          <span class="iconfont icon" v-if="filename.type==='file'">&#xe600;</span>
          <span class="iconfont icon" v-else>&#xe627;</span>
          <a class="filenames" @click="jump(filename)" @mouseover="focus($event)" @mouseleave="blur($event)">{{filename.filename}}</a>
        </div>
      </ul>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
export default {
  name: "FileNavigator",
  data() {
    return {
      files: []
    }
  },
  async created() {
    this.load_files()
  },
  methods: {
    async load_files(){
      console.log(this.$route.path)
      let filepath = this.$route.params.path
      if (filepath === undefined){
        filepath = ""
      }
      const res = await axios({
        url: this.$store.state.url + "/list_files",
        params: {
          filepath: "./plot/"+filepath
        }
      })
      this.files = res.data
      console.log(this.files)
    },
    focus(e) {
      e.target.classList.add("focus")
    },
    blur(e) {
      e.target.classList.remove("focus")
    },
    jump(filename) {
      console.log(filename)
      if (filename.type === "folder"){
        this.$router.push(`${this.$route.params.path===undefined ? "/navigate" : "/navigate/"+this.$route.params.path}/${filename.filename}`)
        this.load_files()
      } else {
        console.log(this.$route.params.path)
        this.$router.push(`/search/${this.$route.params.path}/${filename.filename.replace(".txt","")}`)
      }
    }
  }
}
</script>

<style>
.navigate{
  font-family: iconfont;
}
@font-face {
  font-family: 'iconfont';  /* Project id 4607144 */
  src: url('//at.alicdn.com/t/c/font_4607144_85vhetkevaw.woff2?t=1719925013665') format('woff2'),
       url('//at.alicdn.com/t/c/font_4607144_85vhetkevaw.woff?t=1719925013665') format('woff'),
       url('//at.alicdn.com/t/c/font_4607144_85vhetkevaw.ttf?t=1719925013665') format('truetype');
}

.navigate {
  height: 100%;
  width: 100%;
}

.navigate .filelist{
  height: 100%;
  width: 100%;
}

.navigate .filelist .file{
  height: 10%;
  width: 100%;
  text-align: left;
  margin: 10px;
}

.navigate .filelist .file .icon{
  margin: 10px;
}

.focus {
  color: red;
}
</style>