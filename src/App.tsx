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
      <Toaster position="top-center" />
    </>
  )
}

export default App
