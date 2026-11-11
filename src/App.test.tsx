import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'

afterEach(() => {
  vi.unstubAllGlobals()
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
    expect(await screen.findByRole('heading', { name: '고객 첫 화면' })).toBeInTheDocument()

    stubFetch().mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    await act(() => ApiClient.get('/api/v1/bookings/previous').catch(() => undefined))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument()
  })
})
