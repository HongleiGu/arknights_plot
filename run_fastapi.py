from typing import Union
import os
import uvicorn
import copy
from io import BytesIO
from run_fastapi import FastAPI#, Response
import nest_asyncio
# from transformers import AutoModelForCausalLM, AutoTokenizer
# import torch
import json
import random
app = FastAPI()
from typing import Optional
from pydantic import BaseModel
#第二步导入相应的模块
from PyPDF2 import PdfReader, PdfWriter
import urllib
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

default_content_position = 14

document = {}
# plot = {}
from PyPDF2 import PdfReader

def valid_plot(x):
    if x.split(".")[-1] == "ipynb":
        return False
    if x.split(".")[-1] == "json":
        return False
    if x[0] == ".":
        return False
    return True


@app.get("/list_files")
def list_files(filepath):
    filepath = urllib.parse.unquote(filepath)
    print(filepath)
    filelist = list(filter(valid_plot, os.listdir(filepath)))
    rtrn = []
    for i in filelist:
        if "." in i:
            rtrn.append({"filename": i, "type": "file"})
        else:
            rtrn.append({"filename": i, "type": "folder"})
    print(rtrn)
    return rtrn
        
@app.get("/get_pdf_pages")
def get_num_pages(filename):
    """
    获取文件总页码
    :param file_path: 文件路径
    :return:
    """
    reader = PdfReader(filename + ".pdf")
    # 不解密可能会报错：PyPDF2.utils.PdfReadError: File has not been decrypted
    if reader.is_encrypted:
        reader.decrypt('')
    return len(reader.pages)

@app.get("/get_files")
def get_files(filename):
        
#     print(filename)
    filename = filename.split("#")[0]
    with open("./database.json", "r") as file:
        document[filename] = json.load(file)[filename]
    for i in range(len(document[filename]["plot"])):
        document[filename]["plot"][i]["id"] = i
    return document[filename]["plot"]
#     rtrn = []
#     index = 0
#     with open("./" + filename + ".txt", "r") as file:
#         lines = file.readlines()
#     for i in lines:
#         if i.strip() != "":
#             content = i.strip()[default_content_position:]
#             role = i.strip()[:default_content_position].strip()
#             rtrn.append({"content": content, "role": role,  "id":index})
#             index += 1
#     return rtrn

@app.get("/get_all_comments")
def get_all_comments():
    with open("./database.json", "r") as f:
        temp_document = json.load(f)
    temp_comment = []
    for i in temp_document.keys():
        for j in range(len(temp_document[i]["comments"])):
            temp_document[i]["comments"][j]["filename"] = i
            temp_comment.append(temp_document[i]["comments"][j])
    del temp_document
    return temp_comment
    

@app.get("/get_comments")
def get_comments(filename):
    global document
    filename = filename.split("#")[0]
#     with open("./" + filename + ".json", "r") as f:
    with open("./database.json") as f:
        document[filename]["comments"] = json.load(f)[filename]["comments"]
    print(document[filename]["comments"])
    for i in range(len(document[filename]["comments"])):
        document[filename]["comments"][i]["id"] = i
    return document[filename]["comments"]

@app.get("/update_comments")
def update_comments(filename):
    global document
    filename = filename.split("#")[0]
    return document[filename]["comments"]

@app.get("/add_comments")
def add_comments(content, position, maxId, type, filename):
    global document
    filename = filename.split("#")[0]
    try:
        document[filename]["comments"].append({"filename":filename, "id":maxId,"position":position,"content":content, "type": str(type)})
    except: 
        document[filename]["comments"] = [{"filename":filename,"id":maxId,"position":position,"content":content, "type": str(type)}]

@app.get("/save")
def save(filepath):
    global document
    filepath = filepath.split("#")[0]
#     with open(filepath + ".json", "w", encoding="utf-8") as f:
#         json.dump(document[filepath], f, ensure_ascii=False)
    with open("./database.json","r",encoding="utf-8") as f:
        content = json.load(f)
        content[filepath] = document[filepath]
    with open("./database.json","w",encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False)
        
@app.get("/delete_comments")
def delete_comments(maxId, filename):
    global document
    filename = filename.split("#")[0]
    for i in range(len(document[filename]["comments"])-1, -1, -1):
        if int(document[filename]["comments"][i]["id"]) == int(maxId):
            del document[filename]["comments"][i]
        
@app.get("/edit_comments")
def edit_comments(id, content, filename):
    global document
#     print(id)
    filename = filename.split("#")[0]
    for i in range(len(document[filename]["comments"])):
#         print(comments[i]["id"])
#         print(int(comments[i]["id"]) == int(id))
        if int(document[filename]["comments"][i]["id"]) == int(id):
            document[filename]["comments"][i]["content"] = content
    
@app.get("/get_file_type")
def get_file_type(path):
    if os.path.exists(path + ".txt"):
        return "txt"
    elif os.path.exists(path + ".pdf"):
        return "pdf"
    return ""

@app.get("/get_files_pdf")
def get_files_pdf(filename):
    reader = PdfReader(filename + ".pdf")
    # 不解密可能会报错：PyPDF2.utils.PdfReadError: File has not been decrypted
    if reader.is_encrypted:
        reader.decrypt('')
#     print

    page = reader.pages[0]
    pdf_bytes = BytesIO()
    pdf_writer = PdfWriter()
    pdf_writer.add_page(page)
    pdf_writer.write(pdf_bytes)
    pdf_bytes.seek(0)

    
#     return 
    response = Response(content=pdf_bytes.getvalue(), media_type="application/pdf")

#     设置响应头，告诉浏览器以附件形式保存文件
#     response.headers["Content-Disposition"] = f"attachment; filename={path}.pdf"

    return response

@app.get("/add_answer")
def add_answer(target_filename, target_id, answer_filename, answer_id):
    if (target_filename == answer_filename and target_id == answer_id):
        return
    with open("./database.json", "r") as f:
        temp_document = json.load(f)
    print(temp_document[answer_filename]["comments"])
    print(answer_id)
    temp_solution = copy.deepcopy(temp_document[answer_filename]["comments"][int(answer_id)])
    temp_solution1 = copy.deepcopy(temp_document[target_filename]["comments"][int(target_id)])
    try:
        del temp_solution["solution"]
    except:
        print(1)
    try:
        del temp_solution1["solution"]
    except:
        print(1)
    try:
        if temp_solution not in temp_document[target_filename]["comments"][int(target_id)]["solution"]:
            temp_document[target_filename]["comments"][int(target_id)]["solution"].append(temp_solution)
    except:
        temp_document[target_filename]["comments"][int(target_id)]["solution"]=[temp_solution]
    try:
        if temp_solution1 not in temp_document[answer_filename]["comments"][int(answer_id)]["solution"]:
            temp_document[answer_filename]["comments"][int(answer_id)]["solution"].append(temp_solution1)
    except:
        temp_document[answer_filename]["comments"][int(answer_id)]["solution"]=[temp_solution1]
#     temp_document[answer_filename]["comments"][int(answer_id)]["solution"]=list(set(temp_document[answer_filename]["comments"][int(answer_id)]["solution"]))
    with open("./database.json", "w") as f:
        json.dump(temp_document, f, ensure_ascii=False)
    del temp_solution
    del temp_document

@app.get("/get_answer")
def get_answer(target_filename, target_id):
    with open("./database.json", "r") as f:
        temp_document = json.load(f)
        try:
            return temp_document[target_filename]["comments"][int(target_id)]["solution"]
        except:
            return []

@app.get("/delete_answer")
def delete_answer(target_filename, target_id, answer_filename, answer_id):
    with open("./database.json", "r") as f:
        temp_document = json.load(f)
    index = 0
    while temp_document[target_filename]["comments"][int(target_id)]["solution"][index]["filename"] != answer_filename and temp_document[target_filename]["comments"][int(target_id)]["solution"][index]["id"] != answer_id:
        index+=1
    del temp_document[target_filename]["comments"][int(target_id)]["solution"][index]
    index = 0
    while temp_document[answer_filename]["comments"][int(answer_id)]["solution"][index]["filename"] != target_filename and temp_document[answer_filename]["comments"][int(answer_id)]["solution"][index]["id"] != target_id:
        index+=1
    del temp_document[answer_filename]["comments"][int(answer_id)]["solution"][index]
    with open("./database.json", "w") as f:
        json.dump(temp_document, f, ensure_ascii=False)
        

if __name__ == '__main__':
    # 运行fastapi程序
    nest_asyncio.apply()
    uvicorn.run(app)