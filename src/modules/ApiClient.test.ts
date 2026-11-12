import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClient,
  ApiError,
  CONNECTION_FAILED_MESSAGE,
  GATEWAY_TIMEOUT_MESSAGE,
  REQUEST_TIMEOUT_MS,
  showError,
  UNKNOWN_RESULT_MESSAGE,
} from '@/modules/ApiClient'
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

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof ApiError)) throw new Error(`ApiError가 아니다: ${String(error)}`)
  return error
}

describe('ApiClient 요청', () => {
  it('get은 받은 JSON 본문을 돌려준다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ tourId: 1 }]))

    await expect(ApiClient.get('/api/v1/tours?theme=GOLF')).resolves.toEqual([{ tourId: 1 }])
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/v1/tours?theme=GOLF')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  it('post는 본문을 JSON으로 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' }))

    await ApiClient.post('/api/v1/members/login', { loginId: 'hong', password: 'pw' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe(JSON.stringify({ loginId: 'hong', password: 'pw' }))
  })

  it('본문이 빈 응답(로그아웃의 204)은 undefined로 끝난다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(ApiClient.post('/api/v1/members/logout')).resolves.toBeUndefined()
  })

  it('응답이 시간 제한(REQUEST_TIMEOUT_MS)을 넘기면 연결 실패로 던진다', async () => {
    const timer = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal)
    fetchMock.mockImplementation(
      (_, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const pending = caught(ApiClient.get('/api/v1/members/me'))
    expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS)
    timer.abort(new DOMException('시간 초과', 'TimeoutError'))
    expect(await pending).toMatchObject({ status: null, message: CONNECTION_FAILED_MESSAGE })
  })

  it('/api/v1/로 시작하지 않는 주소는 부르지 않는다', async () => {
    await expect(ApiClient.get('https://uos-mwt.duckdns.org/api/v1/tours')).rejects.toThrow('/api/v1/')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GET 성공 응답의 본문이 JSON이 아니면 연결 실패 문구로 던진다', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html>', { status: 200 }))

    const error = await caught(ApiClient.get('/api/v1/tours'))
    expect(error.message).toBe(CONNECTION_FAILED_MESSAGE)
  })
})

describe('ApiClient 오류 문구', () => {
  it('서버의 message와 상태 코드를 담아 던지고, 알림을 띄우지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '남은 자리보다 인원이 많습니다.' }))

    const error = await caught(ApiClient.post('/api/v1/bookings/quote', {}))
    expect(error).toMatchObject({ status: 400, message: '남은 자리보다 인원이 많습니다.', handled: false })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('연결이 끊기면 상태 코드 없이 연결 실패 문구로 던진다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(ApiClient.get('/api/v1/tours'))
    expect(error).toMatchObject({ status: null, message: CONNECTION_FAILED_MESSAGE, handled: false, resultUnknown: false })
  })

  it.each([
    ['본문이 빈 실패(be가 꺼져 개발 서버 프록시가 낸 502)', new Response('', { status: 502 })],
    ['HTML 본문의 실패(호스팅이 낸 502)', new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['message가 없는 JSON 본문', jsonResponse(503, { error: 'Service Unavailable' })],
    ['message가 빈 문자열인 본문', jsonResponse(500, { message: ' ' })],
  ])('%s는 연결 실패 문구로 던진다', async (_, response) => {
    fetchMock.mockResolvedValue(response)

    const error = await caught(ApiClient.get('/api/v1/tours'))
    expect(error).toMatchObject({ status: response.status, message: CONNECTION_FAILED_MESSAGE })
  })

  it('문구 없는 504는 처리됐는지 알 수 없다는 문구로 던진다(다시 보내도 되는 요청이라 처리됐는지 모름 표시는 없다)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Gateway Timeout</html>', { status: 504 }))

    const error = await caught(ApiClient.get('/api/v1/tours'))
    expect(error).toMatchObject({ status: 504, message: GATEWAY_TIMEOUT_MESSAGE, resultUnknown: false })
  })
})

describe('다시 보내면 두 번 처리되는 요청(unsafeToRetry)', () => {
  const unsafe = { unsafeToRetry: true }

  it('연결이 끊기면 처리됐는지 알 수 없다는 문구와 표시를 붙여 던진다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(ApiClient.post('/api/v1/bookings', { tourId: 1 }, unsafe))
    expect(error).toMatchObject({ status: null, message: UNKNOWN_RESULT_MESSAGE, resultUnknown: true })
  })

  it('오프라인이라 요청이 나가지 않았으면 연결 실패 문구로 던진다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(ApiClient.post('/api/v1/bookings', { tourId: 1 }, unsafe))
    expect(error).toMatchObject({ status: null, message: CONNECTION_FAILED_MESSAGE, resultUnknown: false })
  })

  it.each([
    ['본문이 빈 502(개발 서버 프록시)', new Response('', { status: 502 })],
    ['HTML 본문의 502(호스팅)', new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['Nginx가 문구를 붙인 503(서버가 응답 중에 끊겨도 온다)', jsonResponse(503, { message: '서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.' })],
    ['be의 500(저장한 뒤 반환값 검증에서도 난다)', jsonResponse(500, { message: '서버에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' })],
    ['성공했는데 본문이 JSON이 아님', new Response('<!doctype html>', { status: 200 })],
    ['성공했는데 본문이 빔(앞단이 응답을 자름)', new Response('', { status: 200 })],
    ['본문 없는 201', new Response(null, { status: 201 })],
    // 세 요청 모두 성공하면 결과를 돌려주므로 204도 결과를 못 받은 것이다
    ['204', new Response(null, { status: 204 })],
    ['성공했는데 본문이 객체가 아닌 JSON', new Response('null', { status: 200 })],
  ])('%s도 문구를 바꿔 처리됐는지 알 수 없다고 던진다', async (_, response) => {
    fetchMock.mockResolvedValue(response)

    const error = await caught(ApiClient.post('/api/v1/staff/items', { name: '골프공' }, unsafe))
    expect(error).toMatchObject({ status: response.status, message: UNKNOWN_RESULT_MESSAGE, resultUnknown: true })
  })

  it('504는 처리됐는지 모름 표시를 붙이고, 문구가 있으면 그 문구를 쓴다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(504, { message: '서버 응답이 늦었습니다.' }))

    const error = await caught(ApiClient.post('/api/v1/bookings', {}, unsafe))
    expect(error).toMatchObject({ status: 504, message: '서버 응답이 늦었습니다.', resultUnknown: true })
  })

  it('서버가 문구를 준 4xx는 그 문구로 던지고 처리됐는지 모름 표시를 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '남은 자리보다 인원이 많습니다.' }))

    const error = await caught(ApiClient.post('/api/v1/bookings', { tourId: 1 }, unsafe))
    expect(error).toMatchObject({ status: 400, message: '남은 자리보다 인원이 많습니다.', resultUnknown: false })
  })

  it('문구 없는 4xx는 앞단이 거절해 처리되지 않았으니 연결 실패 문구로 던진다', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Request Entity Too Large</html>', { status: 413 }))

    const error = await caught(ApiClient.post('/api/v1/staff/tours', { theme: 'GOLF' }, unsafe))
    expect(error).toMatchObject({ status: 413, message: CONNECTION_FAILED_MESSAGE, resultUnknown: false })
  })

  it('옵션이 없는 POST(가격 계산 등)는 연결이 끊기면 연결 실패 문구로 던진다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(ApiClient.post('/api/v1/bookings/quote', { tourId: 1 }))
    expect(error).toMatchObject({ status: null, message: CONNECTION_FAILED_MESSAGE, resultUnknown: false })
  })
})

// 화면 이동은 라우터(PageGate)가 맡는다 — routes.test.tsx·App.test.tsx
describe('ApiClient 401·403 처리', () => {
  it('401이면 로그인 상태를 비우고 알린 뒤 처리함 표시를 붙여 던진다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock.mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))

    const error = await caught(ApiClient.get('/api/v1/tours?theme=GOLF'))
    expect(error).toMatchObject({ status: 401, handled: true })
    expect(AuthStore.memberType).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('로그인이 필요합니다.', expect.anything())
  })

  it('403이면 권한이 없다고 알리고, 회원 구분을 다시 읽는다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: '권한이 없습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))

    const error = await caught(ApiClient.get('/api/v1/tours?theme=GOLF'))
    expect(error).toMatchObject({ status: 403, handled: true })
    expect(toast.error).toHaveBeenCalledWith('권한이 없습니다.', expect.anything())
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/members/me')
    expect(AuthStore.memberType).toBe('STAFF')
  })

  it('403이 한꺼번에 여럿 오면 한 번만 다시 읽는다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock.mockImplementation(async (path) =>
      path === '/api/v1/members/me'
        ? jsonResponse(200, { memberType: 'STAFF', name: '김직원' })
        : jsonResponse(403, { message: '권한이 없습니다.' }),
    )

    const errors = await Promise.all([
      caught(ApiClient.get('/api/v1/tours?theme=GOLF')),
      caught(ApiClient.get('/api/v1/bookings/previous')),
    ])
    expect(errors.map((error) => error.handled)).toEqual([true, true])
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/members/me')).toHaveLength(1)
    expect(AuthStore.memberType).toBe('STAFF')
  })

  it('403 뒤 다시 읽은 결과가 로그인하지 않음이면 권한이 아니라 로그인이 필요하다고 알린다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: '권한이 없습니다.' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: '로그인이 필요합니다.' }))

    await caught(ApiClient.get('/api/v1/tours?theme=GOLF'))
    expect(AuthStore.memberType).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('로그인이 필요합니다.', expect.anything())
    expect(toast.error).not.toHaveBeenCalledWith('권한이 없습니다.', expect.anything())
  })

  it('403 뒤 다시 읽기가 서버 실패로 끝나면 로그인 상태를 그대로 두고 그 실패 문구 하나만 알린다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: '권한이 없습니다.' }))
      .mockResolvedValueOnce(jsonResponse(503, { message: '서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.' }))

    const error = await caught(ApiClient.get('/api/v1/bookings/previous'))
    expect(error).toMatchObject({ status: 403, handled: true })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('서버에 잠시 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(AuthStore.memberType).toBe('CUSTOMER')
  })

  it('handleAuthErrors가 false면 401도 처리하지 않고 던지기만 한다', async () => {
    AuthStore.setMember('CUSTOMER', '홍길동')
    fetchMock.mockResolvedValue(jsonResponse(401, { message: '로그인이 필요합니다.' }))

    const error = await caught(ApiClient.get('/api/v1/members/me', { handleAuthErrors: false }))
    expect(error).toMatchObject({ status: 401, handled: false })
    expect(AuthStore.memberType).toBe('CUSTOMER')
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('showError', () => {
  it('처리하지 않은 오류의 문구를 공용 알림으로 보여 준다', () => {
    showError(new ApiError(GATEWAY_TIMEOUT_MESSAGE, 504))

    expect(toast.error).toHaveBeenCalledWith(GATEWAY_TIMEOUT_MESSAGE)
  })

  it('ApiClient가 이미 처리한 오류(401·403)는 다시 보여 주지 않는다', () => {
    showError(new ApiError('권한이 없습니다.', 403, { handled: true }))

    expect(toast.error).not.toHaveBeenCalled()
  })
})
