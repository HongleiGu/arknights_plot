/* eslint-disable @typescript-eslint/ban-ts-comment */
//@ts-nocheck
"use client";


import Image from "next/image";
// import Link from "next/link";
// import "@/app/home/page.scss"
import '@/app/base.scss'; // Your global styles

import { useEffect, useRef,useState} from "react";
import { useRouter } from "next/navigation";


export default function Home() {
  // const links = [
  //   { CNname: "首页", ENname: "HOME", path: "/home"},
  //   { CNname: "导航页", ENname: "NAVIGATE", path: "/navigate"},
  //   { CNname: "文档页", ENname: "DOCUMENT", path: "/home"},
  //   { CNname: "扩展", ENname: "EXTRA", path: "/home"}
  // ]
  const background = useRef<HTMLDivElement | null>(null);
  const [, setScrollHeight] = useState(0);
  const [redirect, setRedirect] = useState<boolean>(true);
  const router = useRouter()
  // console.log(background)
  useEffect(() => {
    if (background.current === null) {
      console.log("background is null");
      return;
    }

    const handleScroll = () => {
      const currentScroll = background.current.scrollTop;
      setScrollHeight(currentScroll);

      // Navigate if scrolled beyond window height
      if (currentScroll >= window.innerHeight) {
        if (redirect) {
          router.push("/navigate");
          setRedirect(false);
          background.current?.removeEventListener("scroll", handleScroll)
        }
      }
    };

    background.current.addEventListener("scroll", handleScroll);

    // return () => {
    //   background.current.removeEventListener("scroll", handleScroll);
    // };
  }, [redirect, router]);

  return (
    <div className="absolute w-full h-full">
      <div className="absolute w-full h-full">
        <div
          className="absolute w-full h-full top-0 left-0 overflow-y-scroll"
          id="gate"
          ref={background}
        >
          <div
            className="relative top-0 left-0 w-full h-[3000px] z-100" 
          >
          </div>
        </div>
        {/* <Image
          className="absolute top-0 left-0 min-w-full min-h-full object-cover" 
          src={`/assets/pics/首页1.png`} 
          alt={"首页"}
          layout="fill"
          style={{opacity: 1-opacity}}
        >
        </Image>
        <Image
          className="absolute top-0 left-0 min-w-full min-h-full object-cover" 
          src={`/assets/pics/首页2.png`} 
          alt={"首页"}
          layout="fill"
          style={{opacity: opacity}}
        >
        </Image> */}
      </div>
      <div className="absolute bg-[rgba(0,0,0,0.7)] w-full h-[20%] bottom-0 flex justify-center align-middle items-center">
      <div className="relative flex flex-col w-[30%] h-[50%] items-center">
        <div className="relative w-[20%] h-[80%] flex-1 overflow-hidden">
          <Image 
            className="absolute top-0 transform translate-x-[15%] object-cover h-full" 
            src={`/assets/pics/活动图标_巴别塔.png`} 
            layout="fill" 
            alt="图标" 
          />
        </div>
        <div className="relative w-[20%] h-[80%] flex-1">
          <Image 
            src={`/assets/pics/arrow.png`} 
            layout="fill"
            alt="箭头" 
            id="arrow"
            className="relative top-0 left-0 max-w-full max-h-full object-contain" 
          />
        </div>
      </div>
    </div>
  </div>
  );
}
