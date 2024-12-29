<script>
import axios from 'axios'
import router from '@/router'
import { ElRow, ElCol,ElButton, ElFormItem, ElForm, ElInput, ElText} from 'element-plus';
import { login, register } from '@/utils/api';
import { useLoginStore } from '@/stores/login';
export default {
  data() {
    return {
      username: '',
      password: '',
      confirm_password: '',
      activate_mode: 'login',
      message: "",
      store: useLoginStore()
    }
  },
  methods: {
    async loginfunc() {
      const data = await login(this.username, this.password)
      if (data.code == 1) {
        this.store.username = this.username;
        localStorage.setItem('login_token', data.data)
        this.$router.push("/")
      }
      this.message = data.data
    },
    async registerfunc() {
      if (this.password != this.confirm_password) {
        this.message = "两次输入的密码不一致"
        return
      }
      const data = await register(this.username, this.password)
      console.log(data)
      if (data.code != 1) {
        this.message = "用户名已被占用"
      }
      else {
        this.message = "注册成功"
      }
    }
  },
  components: {
    ElRow,
    ElCol,
    ElButton,
    ElForm,
    ElFormItem,
    ElInput
  }
}
</script>

<template>
  <div class="background"></div>
  <div class="router-view">
    <div class="container">
      <el-form class="form-container">
        <el-form-item>
          <el-col :gutter="20" :span="16" :offset="4">
            <el-row>
              <el-col :span="10" ref="login">
                <el-button
                  v-if="activate_mode === 'login'"
                  class="mode active-mode"
                  >登录
                </el-button>
                <el-button v-else class="mode" @click="activate_mode = 'login'">
                  登录
                </el-button>
              </el-col>
              <el-col :span="10" ref="register">
                <el-button
                  v-if="activate_mode === 'register'"
                  class="mode active-mode"
                  >注册</el-button
                >
                <el-button
                  v-else
                  class="mode"
                  @click="activate_mode = 'register'"
                  >注册</el-button
                >
              </el-col>
            </el-row>
          </el-col>
        </el-form-item>
        <el-form-item>
          <el-col :gutter="20" :span="16" :offset="4">
            <p>用户名</p>
            <el-input v-model="username" />
          </el-col>
        </el-form-item>
        <el-form-item>
          <el-col :gutter="20" :span="16" :offset="4">
            <p>密码</p>
            <el-input v-model="password" />
          </el-col>
        </el-form-item>
        <el-form-item v-if="activate_mode === 'register'">
          <el-col ref="comfirm_password" :gutter="20" :span="16" :offset="4">
            <p>确认密码</p>
            <el-input v-model="confirm_password" />
          </el-col>
        </el-form-item>
        <el-form-item v-if="message != ''">
          <el-col ref="message" :gutter="20" :span="16" :offset="4">
            <el-text type="danger" >{{message}}</el-text>
          </el-col>
        </el-form-item>
        <el-form-item>
          <el-col :gutter="20" :span="16" :offset="4">
            <el-button
              v-if="activate_mode === 'login'"
              type="danger"
              class="submit-button"
              @click="loginfunc(password, username)"
              >登录</el-button
            >
            <el-button
              v-else
              class="submit-button"
              @click="registerfunc(password, username)"
              >注册</el-button
            >
          </el-col>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";
.container {
  position: absolute;
  top: vh(290);
  width: vw(1000);
  left: vw(460);
  height: vh(500);
  color: white;
  border-radius: 20px;
  background-color: rgba(0,0,0,0.5);
}

.form-container {
  position: absolute;
  height: vh(400);
  top: vh(50);
  width: vw(800);
  right: vw(100);
}

.submit-button {
  width: 100%;
  background-color: darkred;
  color:white;
}

.active-mode {
  background-color: darkred;
  color: white;
}

.mode {
  text-align: center;
  border-radius: 10px;
  border: none;
}

.background {
  background: url(../assets/pics/登录页.png);
  background-size: cover;
  position: absolute;
  height: 100%;
  width: 100%;
}

</style>
