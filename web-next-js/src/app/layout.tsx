"use client"

import Image from "next/image";
import Link from "next/link";
import './base.scss'; // Your global styles
// import "./page.scss"
// import babel_logo from "@assets/pics/babel_logo.png"
import useLoginStore from "./store/login";
import { signOut } from "next-auth/react";


export default function Layout({ children }: { children: React.ReactNode }) {
  const links = [
    { CNname: "首页", ENname: "HOME", path: "/home"},
    { CNname: "导航页", ENname: "NAVIGATE", path: "/navigate"},
    { CNname: "文档页", ENname: "DOCUMENT", path: "/home"},
    { CNname: "扩展", ENname: "EXTRA", path: "/home"}
  ]
  const store = useLoginStore()
  // const [showDrawer, setShowDrawer] = useState(false);
  return (
    <html>
        <body className="fixed flex flex-col">
            <header className="flex flex-row relative h-[100px] w-full z-10 bg-black">
                {/* <Image
                    className="" // Set width to 10%
                    src={babel_logo} 
                    width={50}
                    height={50}
                    alt="babel logo"
                    priority={true}
                /> */}
                <div className="relative p-10 z-[1000] h-full w-[10%] opacity-100">
                  <Image 
                    src={`/assets/pics/babel_logo.png`} 
                    width={100} 
                    height={100} 
                    alt="babel logo" 
                    // onClick={() => setShowDrawer(true)}
                    className="absolute top-0 left-0 max-w-full max-h-full object-contain" // Use w-full for responsive width and h-auto to maintain aspect ratio
                  />
                </div>
                <div className="relative flex flex-row w-[80%] justify-around border-collapse">
                    {links.map(it => (
                        <Link 
                          href={it.path} 
                          className="relative flex-1 flex-col items-start h-full justify-between p-[10px] border-solid border-white md:flex" 
                          key={it.ENname}
                        >
                          <div className="relative flex flex-col justify-around h-full w-full">
                            <p className="routerlink-en text-center text-lg md:text-3xl">{it.ENname}</p>
                            <p className="routerlink-ch text-center text-xs md:text-base">{it.CNname}</p>
                          </div>
                        </Link>
                    ))}
                </div>
                <div className="relative flex flex-row w-[30%]"> {/* Remaining 30% width */}
                    <Link 
                        href="/login" 
                        className="relative flex-1 flex flex-col items-start h-full justify-between p-[10px]" 
                        id="login"
                    >
                        <div className="relative flex flex-col justify-around h-full w-full">
                            {store.user ? 
                                <p className="routerlink-ch text-center text-xs md:text-base">当前用户: {store.user?.name}</p> 
                                :
                                <p className="routerlink-ch text-center text-xs md:text-base">登录/注册</p>
                            }
                        </div>
                    </Link>
                    <a 
                        className="relative flex-1 flex flex-col h-full justify-around p-[10px]"
                        onClick={async () => { 
                            store.setUser(null); 
                            await signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_URL}/home` }); 
                            store.verifyJwt();
                        }}
                    >
                        <span className="relative routerlink-ch text-xs md:text-base">登出</span>
                    </a>
                </div>
            </header>
            <div className="relative flex-grow w-full">
                {children}
            </div>
        </body>
    </html>
  );
}