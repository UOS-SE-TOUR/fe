import { act, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt } from '@/test/router'

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

describe('ApiClient가 받은 401·403 뒤', () => {
  async function respondWith(...responses: Response[]) {
    responses.forEach((response) => fetchMock.mockResolvedValueOnce(response))
    await act(() => ApiClient.get('/api/v1/tours?theme=GOLF').catch(() => undefined))
  }

  it('401이면 로그인 화면으로 보낸다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    const router = renderAt('/tours')
    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()

    await respondWith(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('403 뒤 회원 구분이 바뀌었으면 새 회원 구분의 첫 화면으로 보낸다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    const router = renderAt('/tours')
    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()

    await respondWith(
      jsonResponse(403, { message: '권한이 없습니다.' }),
      jsonResponse(200, { memberType: 'STAFF', name: '김직원' }),
    )
    expect(await screen.findByRole('heading', { name: '직원 메뉴' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff')
  })

  it('403 뒤 회원 구분이 그대로면 지금 화면에 둔다(입력하던 것을 잃지 않게)', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    const router = renderAt('/tours')
    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()

    await respondWith(
      jsonResponse(403, { message: '권한이 없습니다.' }),
      jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }),
    )
    expect(screen.getByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tours')
    expect(toast.error).toHaveBeenCalledWith('권한이 없습니다.', expect.anything())
  })
})

describe('로그인하지 않았을 때', () => {
  it.each(['/', '/tours', '/staff', '/staff/tours/new', '/staff/items'])('%s는 로그인 화면으로 보낸다', async (path) => {
    const router = renderAt(path)

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['/login', '로그인'],
    ['/signup', '회원가입'],
  ])('%s는 로그인 없이 열린다', async (path, title) => {
    const router = renderAt(path)

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(path)
  })

  it('없는 주소는 로그인 화면으로 보낸다', async () => {
    const router = renderAt('/nope')

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('로그인했을 때', () => {
  it.each([
    ['CUSTOMER', '/login', '/', '고객 첫 화면'],
    ['CUSTOMER', '/signup', '/', '고객 첫 화면'],
    ['STAFF', '/login', '/staff', '직원 메뉴'],
    ['STAFF', '/', '/staff', '직원 메뉴'],
    ['CUSTOMER', '/staff', '/', '고객 첫 화면'],
  ] as const)('%s가 %s로 오면 알림 없이 자기 첫 화면(%s)으로 보낸다', async (memberType, path, home, title) => {
    AuthStore.setMember(memberType, '홍길동')
    const router = renderAt(path)

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(home)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['CUSTOMER', '/staff/items', '/', '고객 첫 화면'],
    ['STAFF', '/tours', '/staff', '직원 메뉴'],
  ] as const)('%s가 다른 회원 구분의 화면 주소(%s)로 오면 권한이 없다고 알리고 자기 첫 화면으로 보낸다', async (memberType, path, home, title) => {
    AuthStore.setMember(memberType, '홍길동')
    const router = renderAt(path)

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(home)
    expect(toast.error).toHaveBeenCalledWith('권한이 없습니다.', expect.anything())
  })

  it('자기 화면은 그대로 열고 로그인한 이름을 보여 준다', async () => {
    AuthStore.setMember('STAFF', '김직원')
    const router = renderAt('/staff/tours/new')

    expect(await screen.findByRole('heading', { name: '상품 기획' })).toBeInTheDocument()
    expect(screen.getByText('김직원님으로 로그인했습니다.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff/tours/new')
  })

  it('없는 주소는 자기 첫 화면으로 보낸다', async () => {
    AuthStore.setMember('STAFF', '김직원')
    const router = renderAt('/nope')

    expect(await screen.findByRole('heading', { name: '직원 메뉴' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff')
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('새로고침 직후', () => {
  it('restore가 끝날 때까지 막지 않고 기다렸다가 되살린 로그인 상태로 연다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    const restoring = AuthStore.restore()
    const router = renderAt('/tours')

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('로그인 상태를 확인하는 중입니다.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tours')

    respond(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))
    await restoring
    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tours')
  })
})

describe('로그인한 채 다시 읽을 때(403 뒤)', () => {
  it('응답을 기다리는 동안 지금 화면을 그대로 둔다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    renderAt('/tours')
    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()

    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    let restoring = Promise.resolve(true)
    act(() => {
      restoring = AuthStore.restore()
    })
    expect(AuthStore.getState().restoring).toBe(true)
    expect(screen.getByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()

    respond(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))
    await act(() => restoring)
    expect(screen.getByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()
  })
})
