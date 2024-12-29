// import { listFiles } from "../utils/api"
import './Navigate.scss'
import stoneCoffin from "../assets/pics/石棺.png"
import { goToNav } from '../utils/utils'

import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

type StoryTypes = {
  CNname: string
  ENname: string
}

const NavigatePage: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname; // Get the current path
  const navigate = useNavigate()
  const [selected, setSelected] = useState({ CNname : '主线', ENname: '' })
  const storyTypes: StoryTypes[] = [
    { CNname : '主线', ENname: 'MainStory' },
    { CNname : '故事集', ENname: 'Collections' },
    { CNname : '支线', ENname: 'SideStory' },
    { CNname : '隐藏', ENname: 'Special' },
    { CNname : '集成战略', ENname: 'RogueLike' },
    { CNname : '生息演算', ENname: 'RawHCL' },
  ]
  const selectedItem = (item: StoryTypes, index: number, e: React.MouseEvent) => {
    // console.log(e.currentTarget)
    if (e.currentTarget.nodeName != "SPAN" || e.currentTarget.classList[0] != "list-items"){
      return
    }
    // selected.value = files.value[index]
    setSelected(storyTypes[index])
    e.currentTarget.classList.add("selected")
  }
  
  const unselectedItem = (item: StoryTypes, e: React.MouseEvent) => {
    // selected.value = {}
    setSelected({CNname: "", ENname: ""})
    e.currentTarget.classList.remove("selected")
  }
  return (
    <div className="NavigatePage">
      <div className="nav-page">
        <div className="background">
          <img src={stoneCoffin} alt="石棺"/>
        </div>
        <div className="sidebar">
          <span className="title-en">DATABASE</span>
          <span className="title-arknights">arknights</span>
        </div>
        <div className="list-wrapper">
          <ul className="list">
          {storyTypes.map((item, index) => (
            <li
              className="item"
              key={item.ENname}
              id={item.ENname}
            >
              <span 
                className="list-items" 
                id={item.ENname}
                onClick={() => goToNav(currentPath + "/" + item.ENname, navigate)}
                onMouseOver={(event) => selectedItem(item, index, event)}
                onMouseOut={(event) => unselectedItem(item, event)}
              >
                {item.CNname}
              </span>
              {item.ENname === selected.ENname && (
                <span className="hidden">{item.ENname}</span>
            )}
            </li>
            ))
          }
          </ul>
        </div>
      </div>
    </div>
  )
}

export default NavigatePage