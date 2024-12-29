<script setup>
import { listChoices, listOutcomes } from '@/utils/api';
import { ref, onMounted } from 'vue';
import SingleOutcome from './SingleOutcome.vue';
const props = defineProps({
  decisionId: Number,
  decision: String,
  story: String,
  chapter: String,
  decisionValue: Number,
  storyType: String
})

// the decision value, may be changed
let decisionValue = 1

const emit = defineEmits(['chooseBlock'])
const file = ref([])
const outcome = ref([])

onMounted (async () => {
  file.value = (await listChoices(props.decisionId, props.chapter, props.story))
  choose(decisionValue)
})

const choose = async (decisionValue) => {
  outcome.value = (await listOutcomes(decisionValue, props.decisionId, props.chapter, props.story))
}

const clickChoose = (decisionValue) => {
  emit('chooseBlock', `choice${props.decisionId}-decisionValue${decisionValue}`, null)
  choose(decisionValue)
}
</script>

<template>
  <div class="wrapper">
    <div class="content-item" :id="`choice${decisionId}`">
      <div class="choice"
        v-for="(item, index) in file"
        :key="item.choiceId"
        @click="clickChoose(index+1)"
      >
        <span
          :id="`choice${props.decisionId}-decisionValue${decisionValue}`"
        >{{ item.decision }}</span>
      </div>
    </div>
    <SingleOutcome 
      v-for="(outcome, index) in outcome"
      :outcomeId="outcome.outcomeId"
      :decisionId="outcome.decisionId"
      :dialog="outcome.dialog"
      :speaker="outcome.speaker"
      :dialogType="outcome.dialogType"
      :story="outcome.story"
      :chapter="outcome.chapter"
      :decisionValue="outcome.decisionValue"
      :storyType="outcome.storyType"
      :id="`choice${props.decisionId}-outcome${outcome.outcomeId}`"
      @click="emit('chooseBlock', `choice${props.decisionId}-outcome${outcome.outcomeId}`)"
    >
    </SingleOutcome>
  </div>
</template>

<style lang="scss" scoped>
@import "../assets/base.scss";
.wrapper {
  position: relative;
  left: vw(50);
  margin-top: vh(20);
  height: max-content;
  width: vw(750);
  border: 1px solid white;
  border-radius: 20px;
}

.content-item {
  position: relative;
  margin-top: vh(20);
  height: vh(100);
  width: vw(750);
  border: 1px solid white;
  border-radius: 20px;
  vertical-align: middle;
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center; /* Vertically align items in the center */
  overflow-y: auto;
  margin-top: 10px;
  margin-bottom: 10px;
}

.choice{
  height: vh(30);
  line-height: vh(30);
  position: relative;
  text-align: center;
  color: white;
  border: 1px solid white;
  background-color: #3b3b3b;
  margin: 0 10px; /* Add margin for spacing */
  display: flex; /* Use flex to center content */
  align-items: center; /* Vertically center text */
  justify-content: center; /* Horizontally center text */
}
</style>