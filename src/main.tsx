import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import '@fontsource-variable/inter'
import './index.css'
import { WorkspaceProvider } from './lib/workspace'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
    <Toaster position="top-center" richColors />
  </BrowserRouter>,
)
