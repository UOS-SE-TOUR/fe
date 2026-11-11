import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/components/ui/sonner'
import { setNavigate } from '@/lib/navigation'
import { routes } from '@/router/routes'

const router = createBrowserRouter(routes)
setNavigate((path) => {
  void router.navigate(path, { replace: true })
})

function App() {
  return (
    <>
      <RouterProvider router={router} />
      {/* 화면이 밝은 테마뿐이라 알림도 밝게 고정한다(기본값은 OS 다크 모드를 따른다) */}
      <Toaster position="top-center" theme="light" />
    </>
  )
}

export default App
