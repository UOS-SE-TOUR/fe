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
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
  clearFromLogin()
})

async function logIn(loginId: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('아이디'), loginId)
  await user.type(screen.getByLabelText('비밀번호'), password)
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

describe('LoginPage', () => {
  it('고객으로 로그인하면 고객 첫 화면으로 가고 "로그인 직후" 표시를 켠다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))
    const router = renderAt('/login')

    await logIn('hong', 'password1')

    expect(await screen.findByRole('heading', { name: '고객 첫 화면' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(sentRequest(fetchMock)).toEqual({
      path: '/api/v1/members/login',
      method: 'POST',
      body: { loginId: 'hong', password: 'password1' },
    })
    expect(AuthStore.getState().member).toEqual({ memberType: 'CUSTOMER', name: '홍길동' })
    expect(isFromLogin()).toBe(true)
  })

  it('직원으로 로그인하면 직원 첫 화면으로 가고 "로그인 직후" 표시는 끈다', async () => {
    markFromLogin()
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))
    const router = renderAt('/login')

    await logIn('kim', 'password1')

    expect(await screen.findByRole('heading', { name: '직원 첫 화면' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff')
    expect(isFromLogin()).toBe(false)
  })

  it('로그인 실패(400)면 서버 문구를 화면에 보이고 로그인 화면에 머문다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '아이디 또는 비밀번호가 맞지 않습니다.' }))
    const router = renderAt('/login')

    await logIn('hong', 'wrong-password')

    expect(await screen.findByRole('alert')).toHaveTextContent('아이디 또는 비밀번호가 맞지 않습니다.')
    expect(router.state.location.pathname).toBe('/login')
    expect(AuthStore.getState().member).toBeNull()
    expect(isFromLogin()).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
  })

  it('400이 아닌 실패는 공용 알림으로 보인다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const router = renderAt('/login')

    await logIn('hong', 'password1')

    expect(toast.error).toHaveBeenCalledWith(CONNECTION_FAILED_MESSAGE)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
  })

  it('다시 로그인하면 앞의 실패 문구를 지운다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { message: '아이디 또는 비밀번호가 맞지 않습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))
    renderAt('/login')

    await logIn('kim', 'wrong')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '직원 첫 화면' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('응답을 기다리는 동안 로그인 단추를 막는다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    renderAt('/login')

    await logIn('hong', 'password1')
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    respond(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))
    expect(await screen.findByRole('heading', { name: '고객 첫 화면' })).toBeInTheDocument()
  })

  it('응답 모양이 다르면 로그인하지 않고 공용 알림을 띄운다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'ADMIN', name: '홍길동' }))
    const router = renderAt('/login')

    await logIn('hong', 'password1')

    expect(toast.error).toHaveBeenCalledWith('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(AuthStore.getState().member).toBeNull()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('회원가입 링크로 회원가입 화면에 간다', async () => {
    const router = renderAt('/login')

    await userEvent.setup().click(screen.getByRole('link', { name: '회원가입' }))

    expect(await screen.findByRole('heading', { name: '회원가입' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/signup')
  })
})
