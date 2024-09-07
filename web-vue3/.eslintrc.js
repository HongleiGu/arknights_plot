/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    'prettier/prettier': [
      'warn',
      {
        singleQuote: true, // 单引号
        semi: false, // 无分号
        printWidth: 80, // 每行最多80字符
        trailingComma: 'none', // 数组以及对象最后没有逗号
        endOfline: 'auto' // 换行符不限制
      }
    ],
    'vue/multi-word-component-name': [
      'warn',
      {
        ignores: ['index'] // 检查组件名字有多个单词组成的时候忽略index.vue
      }
    ],
    'vue/no-setup-props-destructure': ['off'], // 关闭props解构的检验(解构会丢失响应性)
    'no-undef': 'error'
  }
}
