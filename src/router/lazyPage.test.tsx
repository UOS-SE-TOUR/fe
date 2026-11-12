import { Suspense, type ComponentType } from 'react'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chunkError = new Error('Failed to fetch dynamically imported module')

// "이 페이지에서 새로고침을 시작했다"는 모듈 값이라 테스트마다 모듈을 새로 불러온다
async function renderLazyPage(load: () => Promise<ComponentType>, reload: () => void) {
  vi.resetModules()
  const { lazyPage } = await import('@/router/lazyPage')
  const { PageLoadError } = await import('@/router/PageLoadError')
  const Page = lazyPage(load, reload)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        errorElement: <PageLoadError />,
        element: (
          <Suspense fallback={<p>받는 중</p>}>
            <Page />
          </Suspense>
        ),
      },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('lazyPage', () => {
  it('화면 파일을 받으면 그 화면을 그리고, 새로고침했다는 표시를 지운다', async () => {
    sessionStorage.setItem('staleChunkReloaded', '1')

    await renderLazyPage(async () => () => <h1>받은 화면</h1>, vi.fn())

    expect(await screen.findByRole('heading', { name: '받은 화면' })).toBeInTheDocument()
    expect(sessionStorage.getItem('staleChunkReloaded')).toBeNull()
  })

  it('처음 못 받으면 새로고침하고, 그동안 오류 화면 없이 기다린다', async () => {
    const reload = vi.fn()

    await renderLazyPage(() => Promise.reject(chunkError), reload)

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(screen.getByText('받는 중')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 불러오기' })).not.toBeInTheDocument()
  })

  it('새로고침하고도 못 받으면 오류 화면과 다시 불러오기 단추를 보인다', async () => {
    sessionStorage.setItem('staleChunkReloaded', '1')
    const reload = vi.fn()

    await renderLazyPage(() => Promise.reject(chunkError), reload)

    expect(await screen.findByText(/화면을 불러오지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('연결이 끊겨 못 받았으면 새로고침하지 않고 오류 화면을 보인다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const reload = vi.fn()

    await renderLazyPage(() => Promise.reject(chunkError), reload)

    expect(await screen.findByText(/화면을 불러오지 못했습니다/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
