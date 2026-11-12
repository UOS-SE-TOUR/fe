import { toast } from 'sonner'
import { currentPath, navigateTo } from '@/lib/navigation'
import { landingPath, pagePaths, type MemberType } from '@/lib/pages'

// 504 문구는 서버 앞단 Nginx가 504에 주는 문구와 같다
export const CONNECTION_FAILED_MESSAGE = '서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'
export const GATEWAY_TIMEOUT_MESSAGE = '서버 응답이 늦어 처리됐는지 알 수 없습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
export const UNKNOWN_RESULT_MESSAGE = '서버와 연결이 끊겨 처리됐는지 알 수 없습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
const UNAUTHORIZED_MESSAGE = '로그인이 필요합니다.'
export const FORBIDDEN_MESSAGE = '권한이 없습니다.'
const UNEXPECTED_MESSAGE = '문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.'

export class ApiError extends Error {
  // 응답 없이 실패했으면 null
  readonly status: number | null
  // ApiClient가 이미 처리했다(401·403). 화면은 보여 주지 않는다
  readonly handled: boolean
  // unsafeToRetry 요청을 서버가 처리했는지 알 수 없다. 화면은 단추를 다시 열지 않고 결과를 다시 읽는다
  readonly resultUnknown: boolean

  constructor(
    message: string,
    status: number | null,
    { handled = false, resultUnknown = false }: { handled?: boolean; resultUnknown?: boolean } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.handled = handled
    this.resultUnknown = resultUnknown
  }
}

interface RequestOptions {
  // false면 401·403도 처리하지 않는다(AuthStore.restore)
  handleAuthErrors?: boolean
  // 다시 보내면 두 번 처리되는 요청(신청·상품 등록·창고 추가)
  unsafeToRetry?: boolean
}

// AuthStore가 불러와질 때 등록한다. ApiClient는 AuthStore를 import하지 않는다(설계의 의존 방향)
interface AuthHandlers {
  clear(): void
  restore(): Promise<MemberType | null>
}

let authHandlers: AuthHandlers | null = null

export function setAuthHandlers(handlers: AuthHandlers) {
  authHandlers = handlers
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return null
  }
}

function serverMessage(parsed: { value: unknown } | null): string | null {
  const value = parsed?.value
  if (typeof value !== 'object' || value === null || !('message' in value)) return null
  const { message } = value
  return typeof message === 'string' && message.trim() !== '' ? message : null
}

function handleUnauthorized(message: string): never {
  authHandlers?.clear()
  toast.error(message, { id: 'unauthorized' })
  navigateTo(pagePaths.LoginPage)
  throw new ApiError(message, 401, { handled: true })
}

// 라우터가 막을 때와 403이 함께 와도 알림은 하나만 뜬다
export function notifyForbidden(message = FORBIDDEN_MESSAGE) {
  toast.error(message, { id: 'forbidden' })
}

// 다른 탭에서 계정이 바뀌었을 수 있어 회원 구분을 다시 읽고 그 첫 화면으로 보낸다
async function handleForbidden(message: string): Promise<never> {
  const memberType = authHandlers ? await authHandlers.restore() : null
  if (memberType) notifyForbidden(message)
  else toast.error(UNAUTHORIZED_MESSAGE, { id: 'unauthorized' })
  const target = landingPath(memberType)
  // 이미 그 화면이면 옮기지 않는다(옮기면 그 화면이 다시 불러 또 403이 된다)
  if (currentPath() !== target) navigateTo(target)
  throw new ApiError(message, 403, { handled: true })
}

function unknownResult(status: number | null): ApiError {
  return new ApiError(UNKNOWN_RESULT_MESSAGE, status, { resultUnknown: true })
}

// 서버에 닿았는지 모르는 실패(연결 끊김, 성공 응답의 본문을 못 받음)
function connectionLost(status: number | null, options: RequestOptions): ApiError {
  return options.unsafeToRetry ? unknownResult(status) : new ApiError(CONNECTION_FAILED_MESSAGE, status)
}

// 서버 앞단이 낸 5xx. be의 Nginx는 502·503을 문구 붙인 503으로 주고, 서버가 처리한 뒤 끊겨도 그렇게 온다(be가 직접 503을 내는 것은 음성뿐)
function isGatewayFailure(status: number, message: string | null): boolean {
  return status === 502 || status === 503 || (status >= 500 && !message)
}

async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, options: RequestOptions): Promise<T> {
  if (!path.startsWith('/api/v1/')) {
    throw new Error(`ApiClient는 /api/v1/로 시작하는 경로만 부른다: ${path}`)
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw connectionLost(null, options)
  }

  let text: string | null
  try {
    text = await response.text()
  } catch {
    text = null
  }
  const parsed = text ? parseJson(text) : null

  if (response.ok) {
    if (text === '') return undefined as T
    if (parsed) return parsed.value as T
    throw connectionLost(response.status, options)
  }

  const message = serverMessage(parsed)
  if (options.handleAuthErrors !== false) {
    if (response.status === 401) return handleUnauthorized(message ?? UNAUTHORIZED_MESSAGE)
    if (response.status === 403) return handleForbidden(message ?? FORBIDDEN_MESSAGE)
  }
  if (response.status === 504) {
    throw new ApiError(message ?? GATEWAY_TIMEOUT_MESSAGE, 504, { resultUnknown: options.unsafeToRetry === true })
  }
  if (options.unsafeToRetry && isGatewayFailure(response.status, message)) throw unknownResult(response.status)
  if (message) throw new ApiError(message, response.status)
  // 문구가 없으면 호스팅·개발 서버 프록시가 낸 실패다(be가 꺼짐 등)
  throw new ApiError(CONNECTION_FAILED_MESSAGE, response.status)
}

export const ApiClient = {
  get<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>('GET', path, undefined, options)
  },

  post<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('POST', path, body, options)
  },
}

// 화면 이슈가 따로 정하지 않은 실패는 이것으로 공용 알림에 보여 준다
export function showError(error: unknown) {
  if (error instanceof ApiError) {
    if (!error.handled) toast.error(error.message)
    return
  }
  console.error(error)
  toast.error(UNEXPECTED_MESSAGE)
}
