// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// import './index.css'
// import App from './App.tsx'
import { RouterProvider } from 'react-router-dom'
import router from './router/index.tsx'
import React from 'react'

createRoot(document.getElementById('root')!).render(
<React.StrictMode>
  <RouterProvider router={router}>
    {/* <App/> */}
  </RouterProvider>
</React.StrictMode>
)
