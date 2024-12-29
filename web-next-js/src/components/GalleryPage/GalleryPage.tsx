import { useParams, usePathname, useRouter } from "next/navigation";
import { listImages, listStory } from "@/utils/api";
import { emptyImage, Images } from "@/utils/dataTypes";
import { useEffect, useState } from "react";
import Image from "next/image";
import { goToNav } from "@/utils";
import "./GalleryPage.scss"

export default function GalleryPage() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useParams<{story: string}>(); // Get the story parameter from the URL
    const story = decodeURI(params.story as string)
    const [currentItem, setCurrentItem] = useState<Images>(emptyImage);
    const [stories, setStories] = useState<string[]>([]);
    const [type, setType] = useState<string>("");

    useEffect(() => {
        const fetchData = async () => {
            if (!story) return; // Return if story is not defined

            // Determine type based on the pathname
            console.log(pathname, pathname.startsWith("/navigate/MainStory"))
            if (pathname.startsWith("/navigate/MainStory")) {
              setType("主线");
            } else if (pathname.startsWith("/navigate/SideStory")) {
              setType("支线");
            } else if (pathname.startsWith("/navigate/Collections")) {
              setType("故事集")
            } else if (pathname.startsWith("/navigate/Special")) {
              setType("特殊")
            } else if (pathname.startsWith("/navigate/RougeLike")) {
              setType("肉鸽")
            }
            console.log(type)
            const storyList = await listStory(type, story as string);
            const imageList = await listImages(type, story as string);
            console.log(storyList, imageList, type, story)
            if (imageList.length > 0) {
                setCurrentItem(imageList[0]); // Assuming the first image is the cover
            } else {
                setCurrentItem(emptyImage); // Handle empty image case
            }

            setStories(storyList);
        };
        fetchData();
    }, [pathname, story, type]); // Dependency on story

    // // Handle loading state or undefined currentItem
    // if (!currentItem || !currentItem.name) {
    //     return <div>Loading...</div>;
    // }

    return (
        <div className="GalleryPage">
            <div className="GalleryPage sidebar">
                { currentItem.name ? <span className="GalleryPage title">{currentItem.name}</span> : null}
                { currentItem.info ? <span className="GalleryPage info">{currentItem.info}</span>: null}
                <div className="GalleryPage list">
                    <div className="GalleryPage wrapper">
                        {stories.map((item, index) => (
                            <div 
                                className="GalleryPage item" 
                                key={index} 
                                onClick={() => {
                                    goToNav(item, router, pathname)}
                                }
                            >
                                <span 
                                    className="GalleryPage name"
                                    onClick={() => {
                                        goToNav(item, router, pathname)}}
                                >{item}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <button onClick={() => goToNav(stories[0], router, pathname)}>
                    开始阅读
                </button>
            </div>
            <div className="GalleryPage background">
                {currentItem.cover ? <Image 
                    src={`/api/imageProxy?url=${currentItem.cover}`} 
                    alt="Story Cover" 
                    width={0} 
                    height={0} 
                    priority={true}
                />: null}
            </div>
            <div className="GalleryPage shade-background">
                {currentItem.cover ? <Image 
                    src={`/api/imageProxy?url=${currentItem.cover}`} 
                    alt="Story Cover" 
                    width={0} 
                    height={0} 
                    priority={true}
                />: null}
            </div>
            <div className="GalleryPage decoration">
              {currentItem.name_en ? <span className="GalleryPage text">{currentItem.name_en}</span> : null}
            </div>
        </div>
    );
}