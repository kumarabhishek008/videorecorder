import { App } from './App'
import { ToastProvider } from './hooks/useToast'

export default function ClientApp() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  )
}
