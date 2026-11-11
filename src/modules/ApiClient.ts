import { toast } from 'sonner'
import { navigateTo } from '@/lib/navigation'
import { homePath, pagePaths } from '@/lib/pages'
import type { MemberType } from '@/modules/AuthStore'

// 서버 문구({"message"})가 없는 실패의 문구. 504는 서버 앞단 Nginx가 504에 주는 문구와 같다
export const CONNECTION_FAILED_MESSAGE = '서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'
export const GATEWAY_TIMEOUT_MESSAGE = '서버 응답이 늦어 처리됐는지 알 수 없습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
const UNAUTHORIZED_MESSAGE = '로그인이 필요합니다.'
export const FORBIDDEN_MESSAGE = '권한이 없습니다.'
const UNEXPECTED_MESSAGE = '문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.'

export class ApiError extends Error {
  // 응답 없이 실패했으면(연결 끊김) null
  readonly status: number | null
  // 401·403처럼 ApiClient가 이미 처리했으면 true. 화면은 이 오류를 보여 주지 않는다
  readonly handled: boolean

  constructor(message: string, status: number | null, handled = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.handled = handled
  }
}

interface RequestOptions {
  // false면 401·403도 처리하지 않고 던지기만 한다(AuthStore.restore)
  handleAuthErrors?: boolean
}

// 401·403 때 로그인 상태를 다루는 길. AuthStore가 불러와질 때 등록한다(설계대로 AuthStore → ApiClient 한 방향만 import한다)
interface AuthHandlers {
  clear(): void
  // 회원 구분을 다시 읽고 그 값을 돌려준다(로그인하지 않았으면 null)
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
  throw new ApiError(message, 401, true)
}

// 권한이 없다는 알림. 라우터가 막을 때와 403이 함께 와도 하나만 뜬다
export function notifyForbidden(message = FORBIDDEN_MESSAGE) {
  toast.error(message, { id: 'forbidden' })
}

// 다른 탭에서 다른 계정으로 로그인했으면 이 탭의 AuthStore가 낡아 있으니 회원 구분을 다시 읽고 그 첫 화면으로 보낸다
async function handleForbidden(message: string): Promise<never> {
  notifyForbidden(message)
  const memberType = authHandlers ? await authHandlers.restore() : null
  navigateTo(memberType ? homePath(memberType) : pagePaths.LoginPage)
  throw new ApiError(message, 403, true)
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
    throw new ApiError(CONNECTION_FAILED_MESSAGE, null)
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
    // 서버는 처리했는데 본문을 받지 못했다. GET이 아니면(신청 등) 다시 보내라고 하면 두 번 될 수 있다
    throw new ApiError(method === 'GET' ? CONNECTION_FAILED_MESSAGE : GATEWAY_TIMEOUT_MESSAGE, response.status)
  }

  const message = serverMessage(parsed)
  if (options.handleAuthErrors !== false) {
    if (response.status === 401) return handleUnauthorized(message ?? UNAUTHORIZED_MESSAGE)
    if (response.status === 403) return handleForbidden(message ?? FORBIDDEN_MESSAGE)
  }
  // 문구가 없으면 서버가 아니라 호스팅·개발 서버 프록시가 낸 실패다(be가 꺼짐 등)
  const fallback = response.status === 504 ? GATEWAY_TIMEOUT_MESSAGE : CONNECTION_FAILED_MESSAGE
  throw new ApiError(message ?? fallback, response.status)
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
