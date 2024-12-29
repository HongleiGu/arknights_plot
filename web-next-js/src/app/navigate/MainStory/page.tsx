"use client";

import Image from "next/image";
// import { Images } from "@/utils/dataTypes";
// import { useRouter } from "next/navigation";
// import { useEffect, useRef, useState } from "react";
import { listImages } from "@/utils/api";
// import { SideDisplayForMainStory } from "./sideDisplay";
import { useEffect, useRef, useState } from "react";
import { Images } from "@/utils/dataTypes";
import { usePathname, useRouter } from "next/navigation";
import "./page.scss"
import { emptyImage } from "@/utils/dataTypes";
// import Image from "next/image";
// import { Images } from "@/utils/dataTypes";
// import { useImageProxy } from "@/utils";


export default function Page() {
  const [currentItem, setCurrentItem] = useState<Images>(emptyImage); // Assuming mainStoryImgs is not empty
  const [mainStoryImgs, setMainStoryImgs] = useState<Images[]>([])
  useEffect(() => {
    window.addEventListener('mousemove', (e) => {
      if (float.current != null) {
        const target = (float.current as HTMLElement)
        target.style.left = e.pageX + 'px'
        target.style.top = e.pageY + 'px'
      }
    })
    const helper = async () => {
      const images = await listImages("主线", null);
      setMainStoryImgs(images);
    }
    helper()
   
  }, [])
  const router = useRouter();
  const pathname = usePathname();

  const float = useRef(null);
  const cover = useRef(null);

  const goToNav = (item: string) => {
    router.push(`${pathname}/${item}`);
  };

  const selectedItem = (item: Images, e: React.MouseEvent<HTMLSpanElement>) => {
    console.log(currentItem, item)
    const target = e.currentTarget as HTMLSpanElement;
    if (target) {
      console.log(target.nodeName, target.classList, target.classList.contains("list-items"))
      if (target.nodeName !== "SPAN" || !target.classList.contains("list-items")) {
        return;
      }
      setCurrentItem(item)
      // currentItem = item; // Assuming currentItem is an object with a value property
      target.classList.add("selected");
    }
  };


  const unselectedItem = (e: React.MouseEvent<HTMLSpanElement>) => {
    setCurrentItem(emptyImage)
    const target = e.currentTarget as HTMLSpanElement;
    target.classList.remove("selected");
  };
  return (
    <div className="mainStoryPage nav-page">
      <div className="mainStoryPage float" ref={float}>
        {currentItem.icon ? <Image src={`/api/imageProxy?url=${currentItem.icon}`} alt={`icon`} width={0} height={0}/> : null}
      </div>
      <div className="mainStoryPage background">
        <Image src={"/assets/pics/石棺.png"} alt="石棺" width={0} height={0}/>
      </div>
      <div className="mainStoryPage sidebar">
        <span className="mainStoryPage title-en">MAIN STORIES</span>
        <span className="mainStoryPage title-arknights">arknights</span>
      </div>
      <div>
        <div className="mainStoryPage list-wrapper">
          <ul className="mainStoryPage list">
            {mainStoryImgs.map((it) => (
              <li
                className="mainStoryPage item"
                key={it.name}
              >
                <span 
                  className="mainStoryPage list-items" 
                  onClick={() => goToNav(it.name)}
                  onMouseOver={(e) => selectedItem(it, e)}
                  onMouseOut={e => unselectedItem(e)}
                  style={{ cursor: `url(${currentItem?.icon})` }}
                >
                  {it.name}
                </span>
                {/* style={{ display: currentItem?.name === it.name ? 'block' : 'none' }} */}
                { currentItem?.name == it.name ?
                <span className="mainStoryPage hidden">
                  {it['name_en']}
                </span> : null}
              </li>
            ))}
          </ul>
        </div>
        {/*这里有问题,组件渲染了但是图片加载不出来,摆了 */}
        <div className="mainStoryPage cover" ref={cover}>
          {/* <img src={getImage(`https://i0.hdslb.com/bfs/new_dyn/383ef9d46dc8dab1ecc07923d9668071161775300.png`)} alt="something" loading="eager"/> */}
          {currentItem.cover ? <Image src={`/api/imageProxy?url=${currentItem.cover}`} alt="Cover image" width={500} height={300}/> : null}
        </div>
      </div>
    </div>
  )
}