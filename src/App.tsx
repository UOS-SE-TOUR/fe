import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/components/ui/sonner'
import { routes } from '@/router/routes'

const router = createBrowserRouter(routes)

function App() {
  return (
    <>
      <div className="flex min-h-svh flex-col">
        <RouterProvider router={router} />
      </div>
      {/* 화면에 다크 모드가 없어 알림도 밝게 고정한다 */}
      <Toaster position="top-center" theme="light" />
    </>
  )
}

export default App
