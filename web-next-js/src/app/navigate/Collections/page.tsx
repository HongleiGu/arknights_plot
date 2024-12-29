"use client";

import Image from "next/image"
import NavigationStoryPic from "@/components/NavigationStoryPic/NavigationStoryPic"
import { goToNav } from "@/utils"
import { emptyImage, Images } from "@/utils/dataTypes";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { listImages } from "@/utils/api";
import "./page.scss"

export default function Page() {
  const router = useRouter();
  const pathname = usePathname();
  const [currentItem, setCurrentItem] = useState<Images>(emptyImage); // Assuming mainStoryImgs is not empty
  const [collectionStoryImgs, setCollectionStoryImgs] = useState<Images[]>([])

  useEffect(() => {
    const helper = async () => {
      const images = await listImages("故事集",null);
      setCollectionStoryImgs(images);
      setCurrentItem(images[0])
    }
    helper()
  }, [])
  return (
    <div className="CollectionPage">
      {currentItem.cover ? <Image className="CollectionPage display" src={`/api/imageProxy?url=${currentItem.cover}`} alt="展示" width={0} height={0} priority={true}/> : null}
      <div className="CollectionPage second-nav-page">
        <div className="CollectionPage sidebar">
          <div className="CollectionPage toc-wrapper">
            <div className="CollectionPage top-arrow">
              <Image src={"/assets/pics/红箭头.png"} alt="向上" width={0} height={0}/>
            </div>
            <ul className="CollectionPage items">
              {collectionStoryImgs.map(it => (
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
              {/* <NavigationStoryPic v-for="item in files" :pic="item.icon" :key="item.name" :name="item.name" @click="changeItem(item)"/> */}
            </ul>
            <div className="CollectionPage down-arrow">
              <Image src="/assets/pics/红箭头.png" alt="向上" width={0} height={0}/>
            </div>
          </div>
        </div>
        <div className="CollectionPage info">
          <div className="CollectionPage underline"></div>
          <span className="CollectionPage text-ch">{currentItem.name}</span>
          <span className="CollectionPage text-en">{currentItem['name_en']}</span>
          <span className="CollectionPage text-info">{currentItem.info}</span>
          <button className="CollectionPage jump" onClick={() => goToNav(currentItem.name, router, pathname)}>点击阅读</button>
        </div>
      </div>
    </div>
  )
}