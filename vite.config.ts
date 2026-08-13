import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import mkcert from "vite-plugin-mkcert"
import framer from "vite-plugin-framer"

export default defineConfig({
  plugins: [react(), mkcert(), framer()],
  server: {
    https: true,
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
})
