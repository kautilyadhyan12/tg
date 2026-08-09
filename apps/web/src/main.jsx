import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// FIRST, and deliberately before App: this module reads the URL's dev pose
// settings once and remembers them for the tab. `App.jsx` routes `/` to
// `<Navigate to="/login" replace />`, and a bare react-router path carries no
// search string — so the settings are destroyed the moment routing begins.
// That cost Kd a whole recording session: eight clips from four different
// addresses all recorded at the defaults (DECISIONS 2026-08-09).
// Importing it here rather than relying on `ActiveWorkout`'s import chain means
// the capture cannot be broken later by lazy-loading a page. In a production
// build the module is inert (`import.meta.env.DEV`).
import './dev/poseTuning'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)