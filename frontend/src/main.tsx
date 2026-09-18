import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { API_MODE } from '@/api/client'
import { ApiError } from '@/api/errors'
import { AuthProvider } from '@/hooks/useAuth'
import { ClockProvider } from '@/hooks/useServerNow'
import { LiveAnnouncer, LiveProvider } from '@/hooks/useLive'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events drive freshness; don't refetch on every focus change.
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

async function start() {
  if (API_MODE === 'mock') {
    const { installMockBackend } = await import('@/mock/transport')
    installMockBackend()
  }
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ClockProvider>
              <LiveProvider>
                <App />
              </LiveProvider>
            </ClockProvider>
          </AuthProvider>
        </BrowserRouter>
        <Toaster position="top-center" richColors closeButton theme={theme} toastOptions={{ className: 'text-base' }} />
        <LiveAnnouncer />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
