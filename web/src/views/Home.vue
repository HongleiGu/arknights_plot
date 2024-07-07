<template>
    <div class="search" @keydown.enter="search(text)">
        <div class="logo">
            <img src="@/assets/rhine.png" alt="这里应有图片">
        </div>
        <div class="search-box">
            <div class="search-wrapper">
                <div class="search">
                    <input v-model="text" @input="getRecommendations" class="search-input">
                    <button @click="search(text)">搜索</button>
                </div>
                <!-- <br>
                <div class="recommendation-wrapper">
                    <ul>
                        <div class="recommendation">
                            <p>1111</p>
                        </div>
                        <div class="recommendation">
                            <p>2222</p>
                        </div>
                    </ul>
                </div> -->
            </div>
            <br>
            <div class="popular-search">
                <span>热门搜索:</span>
                <!-- <router-link to="/搜索?key=1">1</router-link> -->
                <router-link to="/search/1">1</router-link>
                <router-link to="/search/2">2</router-link>
                <router-link to="/search/3">3</router-link>
            </div>
        </div>
    </div>
</template>

<script>
// import axios from 'axios'

export default {
    name: `BaseFind1`,
    data(){
        return {
            text: ""
        }
    },
    methods:{
        search(){
            this.$router.push(`/search/${this.text}`)
        },
        getRecommendations(){
            
        }
    }
}
</script>

<style scoped>
.search{
    position: relative;
    width: 100%;
    height: 100%;
}
.logo{
    position: relative;
    height: 200px;
    width: 100%;
}
.logo img{
    position: absolute;
    left:50%;
    transform: translateX(-100px);
    height: 150px;
    /* border: solid 1px black; */
}

.search-box{
    position: absolute;
    height: 300px;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: left;
    width: 800px;
    left: 50%;
    transform: translateX(-400px);
}

.search-box .recommendation-wrapper{
    position: absolute;
    top: 40px;
    height: 100px/*max-content*/;
    width: 100%;
    display: flex;
    flex-direction: column;
    border-collapse: collapse;
    text-align: left;
}

.search-box .search-wrapper{
    height: 200px;
    width: 100%;
    display: flex;
    flex-direction: column;
    /* border: solid 1px black; */
    /* border-radius: 10px; */
}

.search-box .search{
    /* margin: 10px; */
    position:absolute;
    height: 40px;
    display: flex;
    flex-direction: row;
    justify-content: center;
    text-align: center;
    border-collapse: collapse;
}
.search-box .search-input{
    width: 85%;
    border-radius: 10px 0 0 10px;
    border: 1px solid black;
}
.search-box button{
    width: 15%;
    background-color: darkred;
    border-radius: 0 10px 10px 0;
    color: white;
}
.popular-search{
    position:absolute;
    left:0px;
    margin: 10px;
    top: 40px;
}

.popular-search a{
    margin:5px;
}

</style>