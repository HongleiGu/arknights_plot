// import { useState } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from '/vite.svg'
import { Link, Outlet } from 'react-router-dom'
import './App.scss'
import babel_img from './assets/pics/活动图标_巴别塔.png'

function App() {

  return (
    <div className = "app">
      <header>
        <div className="img-wrapper">
          <img src={babel_img} alt="babel logo"/>
        </div>
        <div className="router-link-wrapper">
          <Link to="/home" className="routerlink">
            <div className="routerlink-inner-wrapper">
              <p className="routerlink-en">HOME</p>
              <p className="routerlink-ch">首页</p>
            </div>
          </Link>
          <Link to="/navigate" className="routerlink">
            <div className="routerlink-inner-wrapper">
              <p className="routerlink-en">NAVIGATE</p>
              <p className="routerlink-ch">导航页</p>
            </div>
          </Link>
          <Link to="/home" className="routerlink">
            <div className="routerlink-inner-wrapper">
              <p className="routerlink-en">DOCUMENT</p>
              <p className="routerlink-ch">文档页</p>
            </div>
          </Link>
          <Link to="/home" className="routerlink">
            <div className="routerlink-inner-wrapper">
              <p className="routerlink-en">EXTRA</p>
              <p className="routerlink-ch">扩展</p>
            </div>
          </Link>
        </div>
        <Link to="/login" className="routerlink" id="login">
          <div className="routerlink-inner-wrapper">
            <img src="" alt="" id="user-pic"/>
          </div>
        </Link>
      </header>
      <Outlet/>
    </div>
  )
}

export default App
