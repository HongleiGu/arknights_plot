import { ref, computed, onMounted } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import router from '@/router'
// import { url } from '@/utils/api'
console.log(import.meta.env.VITE_BASE_URL)

export const useLoginStore = defineStore('login', () => {
  const url = import.meta.env.VITE_BASE_URL
  const username = ref("")
  const loggedIn = ref(false)
  const checkLoginState = async () => {
    const token = localStorage.getItem("login_token") 
    if (token == null) {
      notLoggedIn()
    }
    const data = await axios({
      url: url + '/account/identifyJwt',
      method: 'get',
      params: {
        jwt: token
      },
    })
    if (data.data == null) {
      notLoggedIn()
      return
    }
    username.value = data.data.data.username
    // console.log(data)
    // console.log(username)
    loggedIn.value = true
  }

  const notLoggedIn = () => {
    alert("你还没登录")
    router.push("/login")
  }
  

  onMounted(async () => {
    checkLoginState()
  })
  return { username, loggedIn, checkLoginState, url }
})
