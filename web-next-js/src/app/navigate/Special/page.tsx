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
  const [specialImg, setSpecialImgs] = useState<Images[]>([])

  useEffect(() => {
    window.addEventListener('resize', ()=>{
      setInnerWidth(window.innerWidth)
    })
    const helper = async () => {
      const images = await listImages("特殊",null);
      setSpecialImgs(images);
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
    <div className="SpecialPage">
      <div className="SpecialPage sidebar">
        <span className="SpecialPage title-en">SPECIAL</span>
        <span className="SpecialPage title-arknights">arknights</span>
      </div>
      <div className="SpecialPage list-wrapper">
        <ul className="SpecialPage list">
          {specialImg.length != 0 ? specialImg.map(it => 
            <li className="SpecialPage list-item" 
              onMouseOut={e => unselectedItem(it, e)} 
              onClick={() => goToNav(it.name, router, pathname)} 
              key={it.name}
              onMouseOver={e => selectedItem(it, e)}
            >
              <Image className="SpecialPage image" src={`/api/imageProxy?url=${it.cover}`} style={{left: -it.shift/1920*innerWidth+'px'}} alt="cover" width={0} height={0}/>
              <span className="SpecialPage title">{it.name}</span>
              <span className="SpecialPage title-en">{it['name_en']}</span>
              <span className="SpecialPage view-more">view more</span>
              <div className="SpecialPage view-more"></div>
              {/* <Image className="SpecialPage icon" src={it.icon} alt="icon" width={0} height={0}/> */}
            </li>
          ) : null}
          {/* <li className="SpecialPage list-item" v-for="it in specialImg" @mouseover="selectedItem(it, $event)" @mouseout="unselectedItem(it, $event)" @click="goToNav(it.name)">
            <img className="SpecialPage image" :src="it.cover" :style="{left: -it.shift/1920*innerWidth+'px'}">
            <span className="SpecialPage title">{{it.name}}</span>
            <span className="SpecialPage title-en">{{it['name-en']}}</span>
            <span className="SpecialPage view-more">view more ></span>
            <div className="SpecialPage view-more"></div>
            <img className="SpecialPage icon" :src="it.icon">
          </li> */}
        </ul>
      </div>
      <div className="SpecialPage decoration">
        <span className="SpecialPage text">SPECIAL</span>
      </div>
    </div>
  )
}