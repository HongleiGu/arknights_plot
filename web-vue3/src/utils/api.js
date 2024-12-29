import axios from "axios";
import { useLoginStore } from "@/stores/login";
import router from "@/router";

const store = useLoginStore()
const url = store.url

export async function listFiles(path){
  await store.checkLoginState()
  const res = await axios({
    url: url + "/listFiles",
    method: "get",
    params: {
      filepath: path
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return res.data.data
}

export async function getData(story, chapter, pageNum, pageSize){
  await store.checkLoginState()
  const res = await axios({
    url: url + "/listPlots",
    method: "get",
    params: {
      story: story,
      chapter: chapter,
      pageNum: pageNum,
      pageSize: pageSize
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return res.data.data
}

export async function getComments(story, chapter, username){
  await store.checkLoginState()
  const res = await axios({
    url: url + "/listComments",
    method: "get",
    params: {
      story: story,
      chapter: chapter,
      username: username
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return res.data.data
}

export async function addComment(dialogId, choiceId, outcomeId, story, chapter, username, commentContent, storyType){
  await store.checkLoginState()
  await axios({
    url: url+"/insertComments",
    method: "post",
    data: {
      dialogId: dialogId,
      choiceId: choiceId,        
      outcomeId: outcomeId,
      story: story,
      chapter: chapter,
      username: username,
      commentContent: commentContent,
      storyType: storyType
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
}

export async function deleteComments(commentId){
  await store.checkLoginState()
  await axios({
    url: url+"/deleteComments",
    method: "delete",
    params: {
      commentId: commentId
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
}

export async function editComments(commentId, commentContent){
  await store.checkLoginState()
  console.log("edit")
  return await axios({
    url: url+"/editComments",
    method: "post",
    data: {
      commentId: commentId,
      commentContent: commentContent
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
}

export async function listOutcomes(decisionValue, decisionId, chapter, story){
  await store.checkLoginState()
  const data = await axios({
    url: url+"/listOutcomes",
    method: "get",
    params: {
      story: story,
      decisionValue: decisionValue,
      decisionId: decisionId,
      chapter: chapter
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return data.data.data.list
}

export async function listChoices(decisionId, chapter, story){
  await store.checkLoginState()
  const data = await axios({
    url: url+"/listChoices",
    method: "get",
    params: {
      story: story,
      decisionId: decisionId,
      chapter: chapter
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return data.data.data.list
}

export async function login(username, password) {
  const data = await axios({
    url: url + '/account/login',
    method: 'post',
    data: {
      password: password,
      username: username
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  store.loggedIn = true
  store.username = username
  return data.data
}

export async function register(username, password) {
  const data = await axios({
    url: url + '/account/register',
    method: 'post',
    data: {
      password: password,
      username: username
    },
    headers: {
      "Authorization": localStorage.getItem("login_token") 
    }
  })
  return data.data
}

// export async function checkLoginState() {
//   const token = localStorage.getItem("login_token") 
//   if (token == NULL) {
//     notLoggedIn()
//   }
//   const data = await axios({
//     url: url + '/account/identifyJwt',
//     method: 'post',
//     data: {
//       jwt: token
//     },
//   })
//   if (data.data == null) {
//     notLoggedIn()
//   }
//   store.username = data.data.username
//   store.loggedIn = true
// }

export const debounce = (fn, delay) => {
	let timer;
	return function() {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			fn();
		}, delay);
	}
};
