<template>
    <div class="comments">
        <div class="condition">
            <div class="condition-wrapper">
                <span>剧情名称</span>
                <select v-model="filename" type="radio" :value="filenames[0]">
                    <option value="all">all</option>
                    <option v-for="(name, index) in filenames" :key="index">{{name}}</option>
                </select>
            </div>
            <div class="condition-wrapper">
                <span>查找内容</span>
                <input type="text" v-model="searchText">
            </div>
            <div class="condition-wrapper">
                <span>批注类型</span>
                <select v-model="type" type="radio">
                    <option value="all">all</option>
                    <option value="疑点">疑点</option>
                    <option value="推测">推测</option>
                    <option value="批注">批注</option>
                </select>
            </div>
        </div>
        <br>
        <div class="comment-list">
            <ul>
                <div v-for="(data, index) in temp_comments" :key="index" class="comment-wrapper" :id="'comment'+index" ref="margin" @click="setChosenMargin(index, data.filename)">
                    <span>{{data.filename}}:</span>
                    <single-margin :data="data" :type="data.type" @setChosenMargin="setChosenMargin(index, data.filename)" @edit="notAlter" @deleteComments="notAlter" :filename="data.filename"></single-margin>
                </div>
                <div style="width: 100%; height: 400px;"></div> 
            </ul>
        </div>
        <div class="footer">
            <button class="add" @click="add">添加</button>
        </div>
    </div>
</template>

<script>
import SingleMargin from '@/components/SingleMargin.vue';
// import SingleMargin from '../components/SingleMargin.vue';
import axios from 'axios';
export default {
    name: `BaseFriend`,
    data() {
        return {
            type: "all",
            filename: "all",
            comments: [],
            filenames: [],
            temp_comments: [],
            chosen_margin: -1,
            chosen_filename: "",
            searchText: ""
        }
    },
    components: {
        'SingleMargin': SingleMargin
    },
    async created() {
        const res = await axios({
            url: "http://127.0.0.1:8000/get_all_comments"
        })
        this.comments = res.data
        console.log(this.comments[0])
        this.filenames = this.comments.map(it => it.filename)
        this.filenames = Array.from(new Set(this.filenames))
        // this.filename = this.filenames[0]
        this.temp_comments = this.comments
    },
    methods: {
        add(){
            this.$emit("add", this.chosen_filename, this.temp_comments[this.chosen_margin].id)
        },
        notsupported(){
            console.log("not supported")
        },
        notAlter(){
            alert("you should not alter this")
        },
        setChosenMargin(index, filename){
            console.log("this")
            this.chosen_margin = index
            this.chosen_filename = filename
        },
        search(){
            if (this.type != "all") {
                this.temp_comments = this.temp_comments.filter(it => it.type === this.type)
            }
        },
        searchValidComments(){
            if (this.filename != "all") {
                if (this.type != "all"){
                    this.temp_comments = this.comments.filter(it => it.filename == this.filename && it.type == this.type && it.content.includes(this.searchText))
                } else {
                    this.temp_comments = this.comments.filter(it => it.filename == this.filename && it.content.includes(this.searchText))
                }
            } else {
                if (this.type != "all"){
                    this.temp_comments = this.comments.filter(it => it.type == this.type && it.content.includes(this.searchText))
                } else {
                    this.temp_comments = this.comments.filter(it => it.content.includes(this.searchText))
                }
            }
        }
    },
    watch: {
        filename: {
            handler(){
                this.searchValidComments()
            }
        },
        type: {
            handler(){
                this.searchValidComments()
            }
        },
        searchText: {
            handler(){
                this.searchValidComments()
            }
        },
        chosen_margin(newVal, oldVal) {
            console.log(newVal)
            this.$refs.margin[newVal].classList.add("active-margin")
            if (oldVal != -1){
                this.$refs.margin[oldVal].classList.remove("active-margin")
            }
            // console.log(this.$refs.margin.querySelector(`.dialog[id="comment${newVal}"]`))
        }
    }
}
</script>

<style scoped>
.comments{
    position: relative;
    height: 100%;
    width: 100%;
}
.condition {
    display: flex;
    flex-direction: column;
    height: 30px;
    width: 100%;
    position: relative;
    justify-content:left;
    text-align: left;
}

.condition .condition-wrapper{
    /* position: absolute; */
    /* left: 0px; */
    margin: 10px;
}

.condition .condition-wrapper span{
    margin-right: 20px;
}

.comment-list{
    position: absolute;
    top: 100px;
    /* left: 50%; */
    height: 80%;
    justify-content: center;
    text-align:center;
    margin-top: 10px;
    width: 100%;
    overflow: scroll;
    /* transform: translateX(-350px); */
}

.comment-list .comment-wrapper{
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    line-height: 100%;
    justify-content: space-between;
    margin-bottom: 100px;
    margin-top: 100px;
}

.comment-list .comment-wrapper span{
    margin-right: 50px;
    width: 100%;
}

.footer{
    position: absolute;
    top: 90%;
    height: 10%;
    width: 100%;
}

.footer button{
    position: absolute;
    left: 50%;
    top: 50%;
    width: 50px;
    transform: translateX(-25px);
}

.active-margin{
     box-shadow:0 15px 35px rgba(0,0,0,0.5);
}
</style>