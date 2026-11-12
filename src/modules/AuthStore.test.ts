import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pagePaths, type PageName } from '@/lib/pages'
import { CONNECTION_FAILED_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'

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

describe('AuthStore.restore', () => {
  it('members/me 응답으로 회원 구분과 이름을 되살린다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))

    await AuthStore.restore()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/members/me')
    expect(AuthStore.memberType).toBe('STAFF')
    expect(AuthStore.name).toBe('김직원')
    expect(AuthStore.getState().restoring).toBe(false)
  })

  it('응답을 기다리는 동안 restoring이 켜진다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))

    const restoring = AuthStore.restore()
    expect(AuthStore.getState().restoring).toBe(true)
    respond(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))
    await restoring
    expect(AuthStore.getState().restoring).toBe(false)
  })

  it('401이면 로그인하지 않은 것으로만 두고 알리지 않는다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock.mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))

    await expect(AuthStore.restore()).resolves.toBe(true)
    expect(AuthStore.memberType).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    [
      '서버 오류',
      jsonResponse(500, { message: '서버에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' }),
      '서버에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.',
    ],
    ['be가 꺼짐(개발 서버 프록시의 빈 502)', new Response('', { status: 502 }), CONNECTION_FAILED_MESSAGE],
  ])('새로고침 직후 401이 아닌 실패(%s)도 로그인하지 않은 것으로 두고 그 문구를 알린다', async (_, response, message) => {
    fetchMock.mockResolvedValue(response)

    await expect(AuthStore.restore()).resolves.toBe(false)
    expect(AuthStore.memberType).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(message)
  })

  it('이미 로그인한 상태에서 다시 읽다 401이 아닌 실패가 나면 로그인 상태를 그대로 두고 문구를 알린다', async () => {
    AuthStore.setMember('STAFF', '김직원')
    fetchMock.mockResolvedValue(jsonResponse(503, { message: '서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.' }))

    await AuthStore.restore()
    expect(AuthStore.memberType).toBe('STAFF')
    expect(AuthStore.getState().restoring).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.')
  })

  it('기다리는 중에 다시 부르면 새로 묻지 않고 같은 결과를 기다린다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))

    const first = AuthStore.restore()
    const second = AuthStore.restore()
    respond(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(AuthStore.memberType).toBe('STAFF')

    fetchMock.mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    await AuthStore.restore()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(AuthStore.memberType).toBeNull()
  })

  it('members/me 응답 모양이 다르면 로그인하지 않은 것으로 두고 알린다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'ADMIN', name: '관리자' }))

    await AuthStore.restore()
    expect(AuthStore.memberType).toBeNull()
    expect(AuthStore.getState().restoring).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')
  })

  it('연결이 끊겨도 로그인하지 않은 것으로 두고 연결 실패 문구를 알린다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await AuthStore.restore()
    expect(AuthStore.memberType).toBeNull()
    expect(AuthStore.getState().restoring).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(CONNECTION_FAILED_MESSAGE)
  })

  it('응답을 기다리는 사이 setMember가 오면 늦게 온 응답으로 덮어쓰지 않는다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))

    const restoring = AuthStore.restore()
    AuthStore.setMember('CUSTOMER', '홍길동')
    respond(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    await restoring
    expect(AuthStore.memberType).toBe('CUSTOMER')
    expect(AuthStore.getState().restoring).toBe(false)
  })
})

describe('AuthStore.canOpen', () => {
  const pages = Object.keys(pagePaths) as PageName[]
  const openable = (): PageName[] => pages.filter((page) => AuthStore.canOpen(page))

  it('로그인하지 않았으면 로그인·회원가입 화면만 열 수 있다', () => {
    expect(openable()).toEqual(['LoginPage', 'SignUpPage'])
  })

  it('고객은 고객 화면만 열 수 있다', () => {
    AuthStore.setMember('CUSTOMER', '홍길동')

    expect(openable()).toEqual(['CustomerMainPage', 'TourSelectPage'])
  })

  it('직원은 직원 화면만 열 수 있다', () => {
    AuthStore.setMember('STAFF', '김직원')

    expect(openable()).toEqual(['StaffMainPage', 'TourPlanPage', 'WarehousePage'])
  })

  it('clear하면 다시 로그인하지 않은 상태가 된다', () => {
    AuthStore.setMember('STAFF', '김직원')
    AuthStore.clear()

    expect(AuthStore.memberType).toBeNull()
    expect(AuthStore.name).toBeNull()
    expect(openable()).toEqual(['LoginPage', 'SignUpPage'])
  })
})
