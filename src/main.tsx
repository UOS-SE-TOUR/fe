import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'
import { reloadOnStaleChunk } from '@/lib/staleChunk'
import { AuthStore } from '@/modules/AuthStore'

reloadOnStaleChunk()
void AuthStore.restore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
