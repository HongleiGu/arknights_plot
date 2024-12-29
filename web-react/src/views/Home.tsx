// HomePage.tsx
import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.scss'
import babel_img from "../assets/pics/活动图标_巴别塔.png"
import arrow from "../assets/pics/arrow.png"


const HomePage: React.FC = () => {
  const backgroundRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  console.log(backgroundRef)

  useEffect(() => {
    const background = backgroundRef.current;

    const handleScroll = () => {
      if (background && background.scrollTop >= window.innerHeight) {
        console.log(background.scrollTop);
        console.log(window.innerHeight);
        navigate('/navigate');
      }
    };

    if (background) {
      background.addEventListener('scroll', handleScroll);
    }

    // return () => {
    //   if (background) {
    //     background.removeEventListener('scroll', handleScroll);
    //   }
    // };
  }, [navigate]);

  return (
    <div className="HomePage">
      <div className="background" ref={backgroundRef}>
        <p></p>
      </div>
      <div className="enter">
        <img src={babel_img} alt="图标" className="icon" />
        <div className="arrow-wrapper">
          <img src={arrow} alt="箭头" className="arrow" />
        </div>
      </div>
    </div>
  );
};

export default HomePage;