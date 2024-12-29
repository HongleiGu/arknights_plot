// routes.tsx
import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import HomePage from '../views/Home.tsx';
import App from '../App';
import NavigatePage from '../views/Navigate.tsx';


interface Route {
  path: string;
  element: React.ReactElement;
  children?: Route[]
}

const routes: Route[] = [
  {
    path: "/",
    element: <App/>,
    children: [
      { path: '', element: <Navigate to="/home" replace /> },
      { path: '/home', element: <HomePage /> },
      { path: '/navigate', element: <NavigatePage/>},
      { path: '*', element: <p>404</p> }, // Catch-all route
    ]
  }
];

const router = createBrowserRouter(routes)

export default router