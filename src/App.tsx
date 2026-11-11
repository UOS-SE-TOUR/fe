import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/components/ui/sonner'
import { setNavigate } from '@/lib/navigation'
import { routes } from '@/router/routes'

const router = createBrowserRouter(routes)
// 이미 그 주소면 옮기지 않는다(첫 화면이 부른 API가 403이면 같은 화면으로 다시 옮겨 그 화면이 또 부르게 된다)
setNavigate((path) => {
  if (router.state.location.pathname === path) return
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
