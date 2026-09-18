import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev only: forward /api to the FastAPI app (uvicorn api.index:app --port 8000).
// In production Vercel serves /api/* from the Python serverless function.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
