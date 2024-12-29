import { NavigateFunction } from "react-router-dom"

export const goToNav = async (path: string, navigate: NavigateFunction) => {
  navigate(path)
}