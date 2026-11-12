import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFromLogin, isFromLogin, markFromLogin } from '@/lib/fromLogin'
import { CONNECTION_FAILED_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  AuthStore.setMember('STAFF', '김직원')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
  clearFromLogin()
})

describe('StaffMainPage', () => {
  it('로그인한 직원의 이름을 보여 준다', async () => {
    renderAt('/staff')

    expect(await screen.findByRole('heading', { name: '직원 메뉴' })).toBeInTheDocument()
    expect(screen.getByText('김직원님, 안녕하세요.')).toBeInTheDocument()
  })

  it.each([
    ['상품 기획', '/staff/tours/new'],
    ['창고', '/staff/items'],
  ])('%s 단추로 그 화면에 간다', async (title, path) => {
    const router = renderAt('/staff')

    await userEvent.setup().click(await screen.findByRole('link', { name: new RegExp(`^${title}`) }))

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(path)
  })

  it('로그아웃하면 로그인 상태와 "로그인 직후" 표시를 지우고 로그인 화면으로 보낸다', async () => {
    markFromLogin()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const router = renderAt('/staff')

    await userEvent.setup().click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(sentRequest(fetchMock)).toEqual({ path: '/api/v1/members/logout', method: 'POST', body: undefined })
    expect(AuthStore.getState().member).toBeNull()
    expect(isFromLogin()).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['서버가 실패를 알리면', () => fetchMock.mockResolvedValue(jsonResponse(503, { message: '서버에 잠시 연결할 수 없습니다.' })), '서버에 잠시 연결할 수 없습니다.'],
    ['연결이 끊기면', () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch')), CONNECTION_FAILED_MESSAGE],
  ])('로그아웃 요청이 실패하면(%s) 문구를 보여 주고 로그인 상태를 그대로 둔다', async (_, respond, message) => {
    markFromLogin()
    respond()
    const router = renderAt('/staff')

    await userEvent.setup().click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(toast.error).toHaveBeenCalledWith(message)
    expect(router.state.location.pathname).toBe('/staff')
    expect(AuthStore.getState().member).toEqual({ memberType: 'STAFF', name: '김직원' })
    expect(isFromLogin()).toBe(true)
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
  })

  it('로그아웃 응답을 기다리는 동안 단추를 막는다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    renderAt('/staff')

    await userEvent.setup().click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeDisabled()

    respond(new Response(null, { status: 204 }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
