// app/loading.tsx
import React from 'react';
import "./loading.scss"

const Loading = () => {
  return (
    <div className="loadingContainer">
      <div className="loader"></div>
      <h1>Loading...</h1>
    </div>
  );
};

export default Loading;