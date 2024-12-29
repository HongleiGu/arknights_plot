"use client";

import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { goToNav } from "@/utils";
import { useEffect, useState } from "react";
import { Images } from "@/utils/dataTypes";
import { emptyImage } from "@/utils/dataTypes";
import { listImages } from "@/utils/api";
import Image from "next/image";
import NavigationStoryPic from "../../../components/NavigationStoryPic/NavigationStoryPic"
import "./page.scss"


export default function Page() {

  const router = useRouter();
  const pathname = usePathname();
  const [currentItem, setCurrentItem] = useState<Images>(emptyImage); // Assuming mainStoryImgs is not empty
  const [sideStoryImgs, setSideStoryImgs] = useState<Images[]>([])
  // const float = useRef(null);
  useEffect(() => {
    // window.addEventListener('mousemove', (e) => {
    //   if (float.current != null) {
    //     const target = (float.current as HTMLElement)
    //     target.style.left = e.pageX + 'px'
    //     target.style.top = e.pageY + 'px'
    //   }
    // })
    const helper = async () => {
      const images = await listImages("支线", null);
      setSideStoryImgs(images);
      setCurrentItem(images[0])
    }
    helper()
  }, [])

  return (
    <div className="sideStoryPage">
      {currentItem.cover ? <Image className="sideStoryPage display" src={`/api/imageProxy?url=${currentItem.cover}`} alt="展示" width={0} height={0} priority={true}/> : null}
      <div className="sideStoryPage second-nav-page">
        <div className="sideStoryPage sidebar">
          <div className="sideStoryPage toc-wrapper">
            <div className="sideStoryPage top-arrow">
              <Image src={"/assets/pics/红箭头.png"} alt="向上" width={0} height={0}/>
            </div>
            <ul className="sideStoryPage items">
            {sideStoryImgs.map(it => (
              <li
                key={it.name} 
                onClick={() => setCurrentItem(it)} 
              >
                <NavigationStoryPic 
                  pic={it.icon} 
                  name={it.name} 
                />
              </li>
            ))}
              {/* <SideStoryPic v-for="item in files" :pic="item.icon" :key="item.name" :name="item.name" @click="changeItem(item)"></SideStoryPic> */}
            </ul>
            <div className="sideStoryPage down-arrow">
              <Image src={"/assets/pics/红箭头.png"} alt="向上" width={0} height={0}/>
            </div>
          </div>
        </div>
        <div className="sideStoryPage info">
          <div className="sideStoryPage underline"></div>
          <span className="sideStoryPage text-ch">{currentItem.name}</span>
          <span className="sideStoryPage text-en">{currentItem['name_en']}</span>
          <span className="sideStoryPage text-info">{currentItem.info}</span>
          <button className="sideStoryPage jump" onClick={() => goToNav(currentItem.name, router, pathname)}>点击阅读</button>
        </div>
      </div>
    </div>
  )
}