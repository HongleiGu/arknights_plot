/* eslint-disable @typescript-eslint/ban-ts-comment */
//@ts-nocheck
"use client";


import Image from "next/image";
// import Link from "next/link";
import "@/app/home/page.scss"
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";


export default function Home() {
  // const links = [
  //   { CNname: "首页", ENname: "HOME", path: "/home"},
  //   { CNname: "导航页", ENname: "NAVIGATE", path: "/navigate"},
  //   { CNname: "文档页", ENname: "DOCUMENT", path: "/home"},
  //   { CNname: "扩展", ENname: "EXTRA", path: "/home"}
  // ]
  const background = useRef<HTMLDivElement | null>(null)
  const router = useRouter()
  // console.log(background)
  useEffect(() => {
    if (background.current === null) {
      console.log("background is null")
      return;
    }
    const handleScroll = () => {
        if (background.current.scrollTop >= window.innerHeight) {
            console.log(background.current.scrollTop);
            console.log(window.innerHeight);
            router.push("/navigate");
        }
    };

    // Check if the background ref is available
    if (background.current) {
        background.current.addEventListener("scroll", handleScroll);
    }
  }, [router]); // Add router to the dependency array

  return (
    <div className="HomePage">
      <div className="HomePage background" ref={background}>
        <p></p>
      </div>
      <div className="HomePage enter">
        <div className="HomePage icon">
          <Image src={`/assets/pics/活动图标_巴别塔.png`} layout="fill" objectFit="cover" alt="图标" />
        </div>
        <div className="HomePage arrow-wrapper">
          <Image src={`/assets/pics/arrow.png`} width={0} height = {0} alt="箭头" className="HomePage arrow" />
        </div>
      </div>
    </div>
  );
}
