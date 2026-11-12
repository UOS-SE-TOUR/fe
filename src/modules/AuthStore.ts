import { useSyncExternalStore } from 'react'
import { canOpenPage, memberTypes, type MemberType, type PageName } from '@/lib/pages'
import { ApiClient, ApiError, setAuthHandlers, showError } from '@/modules/ApiClient'

// members/login·members/me 응답 본문
export interface Member {
  memberType: MemberType
  name: string
}

export interface AuthState {
  member: Member | null
  // members/me를 기다리는 중. 회원을 아직 모르면(새로고침 직후) 화면은 막지 않고 기다린다
  restoring: boolean
}

let state: AuthState = { member: null, restoring: false }
// 늦게 끝난 restore가 그 뒤의 setMember·clear를 덮어쓰지 않게 한다
let version = 0
// 기다리는 중에 부른 restore는 이 결과를 함께 기다린다(403이 한꺼번에 와도 한 번만 다시 읽는다)
let pendingRestore: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(next: AuthState) {
  state = next
  listeners.forEach((listener) => listener())
}

function isMember(value: unknown): value is Member {
  if (typeof value !== 'object' || value === null) return false
  const { memberType, name } = value as Record<string, unknown>
  return (memberTypes as readonly unknown[]).includes(memberType) && typeof name === 'string'
}

async function readMember(): Promise<void> {
  const current = ++version
  const before = state.member
  setState({ ...state, restoring: true })
  let member: Member | null
  try {
    const body = await ApiClient.get('/api/v1/members/me', { handleAuthErrors: false })
    if (!isMember(body)) throw new Error(`members/me 응답 모양이 다르다: ${JSON.stringify(body)}`)
    member = body
  } catch (error) {
    if (current !== version) return
    if (error instanceof ApiError && error.status === 401) {
      member = null
    } else {
      // 이미 로그인한 상태면 잠깐의 실패(재배포 중 503 등)로 로그아웃시키지 않는다
      showError(error)
      member = before
    }
  }
  if (current !== version) return
  pendingRestore = null
  setState({ member, restoring: false })
}

export const AuthStore = {
  get memberType(): MemberType | null {
    return state.member?.memberType ?? null
  },

  get name(): string | null {
    return state.member?.name ?? null
  },

  setMember(memberType: MemberType, name: string) {
    version += 1
    pendingRestore = null
    setState({ member: { memberType, name }, restoring: false })
  },

  // 401은 로그인하지 않은 것으로만 두고, 그 밖의 실패는 문구를 알린다
  restore(): Promise<void> {
    pendingRestore ??= readMember()
    return pendingRestore
  },

  canOpen(page: PageName): boolean {
    return canOpenPage(page, state.member?.memberType ?? null)
  },

  clear() {
    version += 1
    pendingRestore = null
    setState({ member: null, restoring: false })
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getState(): AuthState {
    return state
  },
}

setAuthHandlers({
  clear: () => AuthStore.clear(),
  restore: async () => {
    await AuthStore.restore()
    return AuthStore.memberType
  },
})

export function useAuthState(): AuthState {
  return useSyncExternalStore(AuthStore.subscribe, AuthStore.getState)
}
