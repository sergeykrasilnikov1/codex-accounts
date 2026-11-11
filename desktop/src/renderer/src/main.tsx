import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import TrayPopup from './TrayPopup'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.codexSwitcher?.trayPopup ? <TrayPopup /> : <App />}
  </StrictMode>
)
