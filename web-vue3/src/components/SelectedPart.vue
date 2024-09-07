<script setup>
const props = defineProps({
  data: String
})
</script>

<template>
  <span>{{props.data}}</span>
</template>