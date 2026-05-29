import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StatsPanelPreview from './components/StatsPanelPreview.tsx'

const isStatsPreview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'stats'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStatsPreview ? <StatsPanelPreview /> : <App />}
  </StrictMode>,
)
