import axios from "axios";

const url = "http://127.0.0.1:8000"

export async function listFiles(path){
  const res = await axios({
    url: url + "/list_files",
    method: "get",
    params: {
      filepath: path
    }
  })
  console.log(res.data)
  return res.data
}

export async function getData(path){
  const res = await axios({
    url: url + "/get_files",
    method: "get",
    params: {
      filename: path
    }
  })
  console.log(res)
  return res.data
}

export async function getAllComments(path){
  const res = await axios({
    url: url + "/get_comments",
    method: "get",
    params: {
      filename: path
    }
  })
  console.log(res)
  return res.data
}

export async function save(path){
  await axios({
    url: url + "/save",
    method: "get",
    params: {
      filepath: path
    }
  })
}

export async function addComment(comment, path){
  await axios({
    url: url+"/add_comments",
    method: "get",
    params: {
      comment: JSON.stringify(comment),
      filename: path
    }
  })
}

export async function deleteComment(id, path){
  await axios({
    url: url+"/delete_comments",
    method: "get",
    params: {
      maxId: id,
      filename: path
    }
  })
}

export async function editComment(id, content, path){
  await axios({
    url: url+"/edit_comments",
    method: "get",
    params: {
      id: id,
      content: content,
      filename: path
    }
  })
}

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
