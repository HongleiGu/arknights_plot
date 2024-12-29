"use client";

import { goToNav } from "@/utils"
import { listImages } from "@/utils/api"
import { emptyImage, Images } from "@/utils/dataTypes"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Image from "next/image"
import "./page.scss"

export default function Page() {
  
  const router = useRouter()
  const pathname = usePathname()

  const [currentItem, setCurrentItem] = useState(emptyImage)
  const [innerWidth, setInnerWidth] = useState(0)
  const [rougeImg, setRougeImg] = useState<Images[]>([])

  useEffect(() => {
    window.addEventListener('resize', ()=>{
      setInnerWidth(window.innerWidth)
    })
    const helper = async () => {
      const images = await listImages("肉鸽",null);
      setRougeImg(images);
    }
    helper()
  }, [])

  useEffect(() => {
    console.log(currentItem)
  }, [currentItem])

  const selectedItem = (it: Images, e: React.MouseEvent) => {
    let target = e.currentTarget as HTMLElement
    if (target.nodeName == "LI"){
      target = target.children[3] as HTMLElement
    }
    else{
      target = target.parentNode as HTMLElement
      target = target.children[3] as HTMLElement
    }
    setCurrentItem(it)
    target.classList.add("selected")
  }

  const unselectedItem = (it: Images, e: React.MouseEvent) => {
    let target = e.currentTarget as HTMLElement
    if (target.nodeName == "LI"){
      target = target.children[3] as HTMLElement
    }
    else{
      target = target.parentNode as HTMLElement
      target = target.children[3] as HTMLElement
    }
    target.classList.remove("selected")
  }
  return (
    <div className="RougePage">
      <div className="RougePage sidebar">
        <span className="RougePage title-en">ROUGELIKE</span>
        <span className="RougePage title-arknights">arknights</span>
      </div>
      <div className="RougePage list-wrapper">
        <ul className="RougePage list">
          {rougeImg.length != 0 ? rougeImg.map(it => 
            <li className="RougePage list-item" 
              onMouseOut={e => unselectedItem(it, e)} 
              onClick={() => goToNav(it.name, router, pathname)} 
              key={it.name}
              onMouseOver={e => selectedItem(it, e)}
            >
              <Image className="RougePage image" src={`/api/imageProxy?url=${it.cover}`} style={{left: -it.shift/1920*innerWidth+'px'}} alt="cover" width={0} height={0}/>
              <span className="RougePage title">{it.name}</span>
              <span className="RougePage title-en">{it['name_en']}</span>
              <span className="RougePage view-more">view more</span>
              <div className="RougePage view-more"></div>
              {/* <Image className="RougePage icon" src={it.icon} alt="icon" width={0} height={0}/> */}
            </li>
          ) : null}
          {/* <li className="RougePage list-item" v-for="it in rougeImg" @mouseover="selectedItem(it, $event)" @mouseout="unselectedItem(it, $event)" @click="goToNav(it.name)">
            <img className="RougePage image" :src="it.cover" :style="{left: -it.shift/1920*innerWidth+'px'}">
            <span className="RougePage title">{{it.name}}</span>
            <span className="RougePage title-en">{{it['name-en']}}</span>
            <span className="RougePage view-more">view more ></span>
            <div className="RougePage view-more"></div>
            <img className="RougePage icon" :src="it.icon">
          </li> */}
        </ul>
      </div>
      <div className="RougePage decoration">
        <span className="RougePage text">ROUGELIKE</span>
      </div>
    </div>
  )
}