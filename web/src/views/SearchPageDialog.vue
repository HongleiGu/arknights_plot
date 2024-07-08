<template>
    <div class="page">
        <div class="buttons">
            <b-button @click="toggle()">新建注释</b-button>
            <button @click="save()">保存</button>
            <span>当前位置{{ chosen_dialog }}</span>
        </div>
        <div class="document">
            <div class="content" ref="content">
                <ul>
                    <single-dialog :data="data" @setChosenContent="setChosenContent" v-for="data in text" :key="data.id"></single-dialog>
                    <!-- <div class="dialog" :id="data.id" @click="setChosenContent(data.id)">
                        <span class="role">{{data.role}}:</span>
                        <span class="dialog-content">{{data.content}}</span>
                    </div> -->
                </ul>
            </div>
            <div class="margin" ref="margin">
                <ul>
                    <single-margin :data="data" :type="data.type" @setChosenMargin="setChosenMargin" @edit="edit" @deleteComments="deleteComments" @showSelectionModal="showSelectionModal(data)" v-for="data in comments" :key="data.id"></single-margin>
                    <!-- <div class="dialog" @click="setChosenMargin(data.id)" :id="data.id">
                        <div class="info">
                            <span>注释{{data.id + 1}}</span>
                            <span>位置{{data.position}}</span>
                        </div>
                        <textarea type="text" disabled="disabled" :value="data.content"></textarea>
                        <div class="buttons">
                            <button class="edit" @click="edit($event, data.id)">编辑</button>
                            <button class="delete" @click="deleteComments(data.id)">删除</button>
                            <a :href="'#'+data.position" class="dialog-content">跳转</a>
                        </div>
                    </div> -->
                </ul>
            </div>
        </div>
        <b-modal
            v-model="show"
            ref="modal"
            class="modal"
            id="modal"
            hide-footer
            hide-header
            dismissible
        >
            <div class="modal-content">
                <div class="modal-header">
                    <b-button class="modal-button close-button" @click="hideModal">
                        X
                    </b-button>
                </div>
                <div class="modal-content-wrapper">
                    <div class="modal-input">
                        <span>注释位置    </span><input v-model="position" type="text" id="position">
                    </div>
                    <br>
                    <div class="modal-input">
                        <span>注释内容     </span><input v-model="content" type="text" id="position">
                    </div>
                    <br>
                    <div class="modal-type">
                        <span>注释类型     </span>
                        <select v-model="type" type="radio" id="position">
                            <option value="疑点">疑点</option>
                            <option value="推测">推测</option>
                            <option value="批注">批注</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <b-button class="modal-button close-button" @click="addComments()">
                        新建注释
                    </b-button>
                </div>
            </div>
        <!-- <b-button class="mt-2" variant="outline-warning" block @click="toggleModal">Toggle Me</b-button> -->
        </b-modal>
        <selection-panel v-if="showSelectionPanel" @showSelectionModal="showSelectionModal" :currentData="currentData"></selection-panel>
    </div>
</template>
<!-- <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.2/dist/js/bootstrap.min.js"></script> -->
<script>
import axios from 'axios'
import SingleDialog from '../components/SingleDialog.vue'
import SingleMargin from '../components/SingleMargin.vue'
import SelectionPanel from '../components/SelectionPanel.vue'
// import Comments from './Comments.vue'
// import BootstrapVue from 'boomotstrap-vue'
// import bootstrap from 'bootstrap'
export default {
    name: `BaseFind`,
    methods: {
        async addComments(){
            console.log(this.type)
            console.log(typeof(this.type))
            this.toggle()
            this.max_id = parseInt(this.max_id) + 1
            console.log(this.max_id)
            // this.comments.push({"position":this.position, "content":this.content, "id": this.max_id, "type": this.type})
            await axios({
                url: this.$store.state.url + "/add_comments",
                params: {
                    content: this.content,
                    position: this.position,
                    maxId: this.max_id,
                    type: this.type,
                    filename: this.filename
                    //"./plot/主线/序章/上"
                }
            })
            this.show = false
            await this.updateComments()
        },
        toggle(){
            this.show = !this.show
        },
        setChosenContent(id){
            this.chosen_dialog = id
        },
        setChosenMargin(id){
            this.chosen_margin = id
        },
        async deleteComments(id){
            this.comments = this.comments.filter(a => (a.id != id))
            console.log(id)
            await axios({
                url: this.$store.state.url + "/delete_comments",
                params: {
                    maxId: id,
                    filename: this.filename
                    //"./plot/主线/序章/上"
                }
            })
            await this.updateComments()
        },
        async edit(id, content){
            // console.log("edit")
            this.comments.map(it => {
                if (it.id == id){
                    it.content = content
                }
            })
            await axios({
                url: this.$store.state.url + "/edit_comments",
                params: {
                    id: id,
                    content: content,//e.currentTarget.parentNode.previousElementSibling.value,
                    filename: this.filename
                    //"./plot/主线/序章/上"
                }
            })
            await this.updateComments()
        },
        async save(){
            await this.updateComments()
            axios({
                url: this.$store.state.url + "/save",
                params: {
                    // comments: JSON.stringify(this.comments),
                    filepath: this.filename//"./plot/主线/序章/上
                }
            })
        },
        hideModal(){
            this.$refs.modal.hide()
        },
        async updateComments () {
            await axios({
                url: this.$store.state.url + "/update_comments",
                params: {
                    filename: this.filename
                }
            }).then(response => {
                this.comments = response.data
            })
        },
        showSelectionModal(data){
            this.currentData = data
            this.showSelectionPanel = !this.showSelectionPanel
        }
    },
    async created () {
        let flag = 0
        this.max_id = this.comments.length
        // console.log(this.$route.query.key)
        await axios({
            url: this.$store.state.url + "/get_files",
            params: {
                filename: this.filename//"./plot/主线/序章/上"
            }
        }).then(response => {
            this.text = response.data
        }).catch(() => {
            this.$router.push("/notfound")
            flag = 1
        })
        // this.updateComments()
        if (flag === 1){
            return
        }
        await axios({
            url: this.$store.state.url + "/get_comments",
            params: {
                filename: this.filename//"untitled.txt"
            }
        }).then(response => {
            this.comments = response.data
        }).catch(() => {
            this.$router.push("/notfound")
            flag = 1
        })
        // const modelDom = document.querySelector("#bootstrap-modal-search")
        // console.log(modelDom)
        // console.log(bootstrap)
        // this.modal = new bootstrap.Modal(modelDom)
        // console.log(this.modal)
    },
    data(){
        return {
            text: [],
            comments: [],
            model: null,
            position: 0,
            content: "",
            max_id: 0,
            show: false,
            chosen_dialog: -1,
            chosen_margin: -1,
            type: "margin",
            filename: this.$route.params.path,
            showSelectionPanel: false,
            currentData: {"id":-1,"type":"疑点"}
        }
    },
    watch: {
        chosen_dialog(newVal, oldVal) {
            this.$refs.content.querySelector(`.dialog[id="dialog${newVal}"]`).classList.add("active-content")
            if (oldVal != -1){
                this.$refs.content.querySelector(`.dialog[id="dialog${oldVal}"]`).classList.remove("active-content")
            }
            console.log(this.$refs.content.querySelector(`.dialog[id="dialog${newVal}"]`))
        },
        chosen_margin(newVal, oldVal) {
            this.$refs.margin.querySelector(`.dialog[id="comment${newVal}"]`).classList.add("active-margin")
            if (oldVal != -1){
                this.$refs.margin.querySelector(`.dialog[id="comment${oldVal}"]`).classList.remove("active-margin")
            }
            console.log(this.$refs.margin.querySelector(`.dialog[id="comment${newVal}"]`))
        }
    },
    components:{
        'singleDialog': SingleDialog,
        'singleMargin': SingleMargin,
        'selectionPanel': SelectionPanel,
        // 'comments': Comments
    }
}
</script>

<style scoped>
.page{
    height: 100%;
    position: relative;
}
.buttons{
    display: flex;
    flex-direction: row;
    justify-content: left;
}
.buttons button{
    margin: 10px;
    height: 40px;
    width: 80px;
}

.document{
    display: flex;
    flex-direction: row;
    justify-content: left;
    height: 100%;
    width: 100%;
}

.content{
  height: 100%;
  border: solid 1px black;
  margin: 5px;
  overflow: scroll;
  text-align: left;
  width: 100%;
  overflow-x: hidden;
  border-radius: 10px 0 0 10px;
}

.document .margin{
    height: 100%;
    border: solid 1px black;
    margin: 5px;
    overflow: scroll;
    text-align: left;
    width: 25%;
    border-radius: 0 10px 10px 0 ;
    justify-content: left;
}

#modal___BV_modal_outer_{
    position: fixed;
    height: 100%;
    width: 100%;
    background-color: rgba(0,0,0,0.5);
    top:0%;
    left:0%;
}

.modal .modal-content {
    height: 400px;
    width: 600px;
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-300px, -200px);
    border: solid 2px black;
    background-color: #fff;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    vertical-align: middle;
}

/* .modal-content{
    display:block;
    height: 100%;
    width: 100%;
    background-color: #fff;
    position: relative;
} */
.modal-content .modal-header{
    position: absolute;
    top:0%;
    width: 100%;
    height: 15%;
}

.modal-content .modal-header button{
    position: absolute;
    top: 0px;
    left: 0px;
    margin: 10px;
    width: max-content;
    height: 20px;
    background-color: black;
    border-radius: 5px;
    color: white;
}

.modal-content .modal-content-wrapper{
    position: absolute;
    top:20%;
    width: 100%;
    height: 60%;
    text-align: center;
    vertical-align: middle;
    justify-content: center;
}
.modal-content .modal-content-wrapper .modal-input{
    width: 100%;
    height: 40px;
    margin: 20px;
    transform: translateX(-15px);
}
.modal-content .modal-content-wrapper .modal-input input{
    height: 30px;
}
.modal-content .modal-content-wrapper .modal-input span{
    margin-right: 20px;
    width: 30px;
}
.modal-content .modal-footer{
    position: absolute;
    top:85%;
    width: 100%;
    height: 15%;
}

.modal-content .modal-footer button{
    position: absolute;
    bottom: 0px;
    right: 0px;
    margin: 10px;
    width: max-content;
    height: 40px;
    background-color: darkred;
    border-radius: 5px;
    color: white;
}

</style>