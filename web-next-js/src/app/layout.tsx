"use client"

import Image from "next/image";
import Link from "next/link";
// import babel_logo from "../../public/assets/pics/babel_logo.png"
import './globals.css'; // Your global styles
import "./page.scss"
import useLoginStore from "./store/login";


export default function Layout({ children }: { children: React.ReactNode }) {
  const links = [
    { CNname: "首页", ENname: "HOME", path: "/home"},
    { CNname: "导航页", ENname: "NAVIGATE", path: "/navigate"},
    { CNname: "文档页", ENname: "DOCUMENT", path: "/home"},
    { CNname: "扩展", ENname: "EXTRA", path: "/home"}
  ]
  const store = useLoginStore()
  return (
    <html>
      <body>
      <header className="base">
        <div className="base img-wrapper">
          <Image src={`/assets/pics/babel_logo.png`} width={100} height={100} alt="babel logo"/>
        </div>
        <div className="base router-link-wrapper">
          {
            links.map(it => 
              <Link href={it.path} className="base routerlink" key={it.ENname}>
                <div className="base routerlink-inner-wrapper">
                  <p className="base routerlink-en">{it.ENname}</p>
                  <p className="base routerlink-ch">{it.CNname}</p>
                </div>
              </Link>
            )
          }
        </div>
        {/* <div className="base router-link-wrapper">
          <Link href="/home" className="base routerlink">
            <div className="base routerlink-inner-wrapper">
              <p className="base routerlink-en">HOME</p>
              <p className="base routerlink-ch">首页</p>
            </div>
          </Link>
          <Link href="/navigate" className="base routerlink">
            <div className="base routerlink-inner-wrapper">
              <p className="base routerlink-en">NAVIGATE</p>
              <p className="base routerlink-ch">导航页</p>
            </div>
          </Link>
          <Link href="/home" className="base routerlink">
            <div className="base routerlink-inner-wrapper">
              <p className="base routerlink-en">DOCUMENT</p>
              <p className="base routerlink-ch">文档页</p>
            </div>
          </Link>
          <Link href="/home" className="base routerlink">
            <div className="base routerlink-inner-wrapper">
              <p className="base routerlink-en">EXTRA</p>
              <p className="base routerlink-ch">扩展</p>
            </div>
          </Link> 
        </div> */}
        <Link href="/login" className="base routerlink" id="login">
          <div className="base routerlink-inner-wrapper">
            {/* <Image src={null} alt="" id="user-pic"/> */}
            { store.user ? 
              <p className="base routerlink-ch">当前用户:{store.user?.name}</p> 
              :
              <p className="base routerlink-ch">登录/注册</p>
            }
          </div>
        </Link>
      </header>
      {/* <RouterView className="base routerview"/> */}
      <div className="base routerview">
        {children}
      </div>
    </body>
    </html>
  );
}
