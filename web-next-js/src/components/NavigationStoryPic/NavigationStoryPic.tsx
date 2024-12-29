import Image from "next/image";
import "./NavigationStoryPic.scss"

export default function Page({pic, name}: {pic: string, name: string}) {
  return (
    <div className="NavigationStoryPic grid">
      <div className="NavigationStoryPic wrapper">
        <Image src={`/api/imageProxy?url=${pic}`} alt="test" width={0} height={0} priority={true} />
        <div className="NavigationStoryPic bottom-bar">
          <span className="NavigationStoryPic text">{name}</span>
          <div className="NavigationStoryPic underline"></div>
        </div>
      </div>
    </div>
  )
}