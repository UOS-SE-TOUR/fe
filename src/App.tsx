import { Plane } from 'lucide-react'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/components/ui/sonner'
import { routes } from '@/router/routes'

const router = createBrowserRouter(routes)

function App() {
  return (
    <>
      <div className="flex min-h-svh flex-col">
        <header className="border-b bg-card">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2.5 px-6">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Plane className="size-4" />
            </span>
            <span className="font-semibold tracking-tight">미스터 월드 테마 여행</span>
          </div>
        </header>
        <RouterProvider router={router} />
      </div>
      {/* 화면에 다크 모드가 없어 알림도 밝게 고정한다 */}
      <Toaster position="top-center" theme="light" />
    </>
  )
}

export default App
