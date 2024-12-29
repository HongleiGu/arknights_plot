import axios from 'axios'

const httpInstance = axios.create({
  baseURL: import.meta.env.BASE_URL,
  timeout: 500
})

const url = import.meta.env.BASE_URL

// httpInstance.interceptors.request.use (
//   (config) => {
//     return config
//   },
//   (error) => {
//     return Promise.reject(error)
//   }
// )

// httpInstance.interceptors.response.use (
//   (response) => {
//     return response
//   },
//   (error) => {
//     return Promise.reject(error)
//   }
// )

export default httpInstance

type Result<T> = {
  code: number
  message: string
  data: T
}

export function listFiles(path: string) {
  return httpInstance.request<Result<string[]>>({
    url: url + "/listFiles",
    method: "get",
    params: {
      filepath: path
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
}