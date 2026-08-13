import React from "react"
import { createRoot } from "react-dom/client"
import { framer } from "@framer/plugin"
import "@framer/plugin/framer.css"
import "./styles.css"
import App from "./App"

framer.showUI({
  width: 420,
  height: 620,
})

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
