import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: '首页',
      component: () => import('@/views/HomePage.vue')
      // 只有在到相关页面的时候才会import,节省内存
    },
    {
      path: '/navigate/',
      name: '导航页',
      component: () => import('@/views/NavigatePage.vue'),
    },
    {
      path: '/navigate/sidestory',
      name: 'sidestory导航页',
      component: () => import('@/views/SideStoryNavigatePage.vue')
    },
    {
      path: '/navigate/sidestory/:story',
      name: 'sidestory第二导航页',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/navigate/sidestory/:story/:file',
      name: '支线阅读页',
      component: () => import('@/views/ReadPage.vue')
    },
    {
      path: '/navigate/mainStory',
      name: '主线导航页',
      component: () => import('@/views/MainStoryNavigatePage.vue')
    },
    {
      path: '/navigate/mainStory/:story',
      name: '主线第二导航页',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/navigate/mainstory/:story/:file',
      name: '主线阅读页',
      component: () => import('@/views/ReadPage.vue')
    },
    {
      path: '/navigate/Collections',
      name: '故事集',
      component: () => import('@/views/CollectionsNavigatePage.vue')
    },
    {
      path: '/navigate/Collections/:story',
      name: '故事集导航页',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/navigate/Collections/:story/:file',
      name: '阅读页',
      component: () => import('@/views/ReadPage.vue')
    },
    {
      path: '/navigate/special',
      name: '特殊',
      component: () => import('@/views/SpecialPage.vue')
    },
    {
      path: '/navigate/special/:story',
      name: '特殊导航页',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/navigate/special/:story/:file',
      name: '特殊阅读页',
      component: () => import('@/views/ReadPage.vue')
    },
    {
      path: '/navigate/RogueLike',
      name: '肉鸽',
      component: () => import('@/views/RogueLikePage.vue')
    },
    {
      path: '/navigate/RogueLike/:story',
      name: '肉鸽导航页',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/navigate/RogueLike/:story/:file',
      name: '肉鸽阅读页',
      component: () => import('@/views/ReadPage.vue')
    },
    {
      path: '/navigate/RawHCL',
      name: '生息演算',
      component: () => import('@/views/GalleryPage.vue')
    },
    {
      path: '/login',
      name: "登录",
      component: () => import('@/views/LoginPage.vue')
    }
  ]
})

export default router
