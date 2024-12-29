"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import "./page.scss"

type NavItem = {
  CNname: string;
  ENname: string;
};

function Page() {
  const files: NavItem[] = [
    { CNname: '主线', ENname: 'MainStory' },
    { CNname: '故事集', ENname: 'Collections' },
    { CNname: '支线', ENname: 'SideStory' },
    { CNname: '隐藏', ENname: 'Special' },
    { CNname: '集成战略', ENname: 'RougeLike' },
    { CNname: '生息演算', ENname: 'RawHCL' },
  ];

  const router = useRouter();
  const pathname = usePathname();

  const goToNav = async (item: NavItem) => {
    router.push(`${pathname}/${item.ENname}`);
  };

  const [selected, setSelected] = useState<NavItem | null>(null);

  const selectedItem = (item: NavItem, index: number, e: React.MouseEvent<HTMLSpanElement>) => {
    const target = e.target as HTMLSpanElement;
    if (!target || target.nodeName !== "SPAN" || !target.classList.contains("list-items")) {
      return;
    }
    setSelected(item);
    target.classList.add("selected");
  };

  const unselectedItem = (e: React.MouseEvent<HTMLSpanElement>) => {
    const target = e.target as HTMLSpanElement;
    setSelected(null);
    if (target && target.classList.contains("selected")) {
      target.classList.remove("selected");
    }
  };

  return (
    <div className="nav nav-page">
      <div className="nav background">
        <Image src={"/assets/pics/石棺.png"} alt="石棺" width={100} height={100} />
      </div>
      <div className="nav sidebar">
        <span className="nav title-en">DATABASE</span>
        <span className="nav title-arknights">arknights</span>
      </div>
      <div className="nav list-wrapper">
        <ul className="nav list">
          {files.map((item, index) => (
            <li
              className="nav item"
              key={item.ENname}
              id={item.ENname}
              onClick={() => goToNav(item)}
              onMouseOver={(e) => selectedItem(item, index, e)}
              onMouseOut={unselectedItem}
            >
              <span className="nav list-items" id={item.ENname}>
                {item.CNname}
              </span>
              {item.ENname === selected?.ENname && (
                <span className="nav hidden">{item.ENname}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default Page;