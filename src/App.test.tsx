import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

describe('App', () => {
  it('공용 알림이 붙어 있어 오류 문구가 화면에 보인다', async () => {
    render(<App />)

    act(() => showError(new ApiError('남은 자리보다 인원이 많습니다.', 400)))
    expect(await screen.findByText('남은 자리보다 인원이 많습니다.')).toBeInTheDocument()
  })

  it('ApiClient가 받은 401로 라우터가 로그인 화면으로 옮긴다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()

    stubFetch().mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    await act(() => ApiClient.get('/api/v1/bookings/previous').catch(() => undefined))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument()
  })

  it('403 뒤 다시 읽은 회원 구분이 그대로이고 이미 그 첫 화면이면 다시 옮기지 않는다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()

    const replaceState = vi.spyOn(window.history, 'replaceState')
    stubFetch().mockImplementation(async (path) =>
      path === '/api/v1/members/me'
        ? jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' })
        : jsonResponse(403, { message: '권한이 없습니다.' }),
    )
    await act(() => ApiClient.get('/api/v1/bookings/previous').catch(() => undefined))
    expect(screen.getByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(replaceState).not.toHaveBeenCalled()
  })
})
