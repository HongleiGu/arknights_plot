import Vuex from 'vuex'
import Vue from 'vue'
Vue.use(Vuex)

const store = new Vuex.Store({
  state: {
      url: 'http://172.19.16.1:8000'
  }
})

export default store