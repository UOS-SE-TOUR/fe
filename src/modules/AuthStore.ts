import { useSyncExternalStore } from 'react'
import { memberTypes, pageAccess, type MemberType, type PageName } from '@/lib/pages'
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
let pendingRestore: Promise<boolean> | null = null
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

// 서버가 답했으면(로그인했거나 401) true, 다른 실패로 회원 구분을 확인하지 못했으면 false
async function readMember(): Promise<boolean> {
  const current = ++version
  // 이미 로그인한 상태면 잠깐의 실패(재배포 중 503 등)로 로그아웃시키지 않는다
  let member = state.member
  let confirmed = false
  setState({ ...state, restoring: true })
  try {
    const body = await ApiClient.get('/api/v1/members/me', { handleAuthErrors: false })
    if (!isMember(body)) throw new Error(`members/me 응답 모양이 다르다: ${JSON.stringify(body)}`)
    member = body
    confirmed = true
  } catch (error) {
    if (current === version) {
      if (error instanceof ApiError && error.status === 401) {
        member = null
        confirmed = true
      } else {
        showError(error)
      }
    }
  } finally {
    if (current === version) {
      pendingRestore = null
      setState({ member, restoring: false })
    }
  }
  // 그사이 setMember·clear가 왔으면 지금 상태가 이미 맞다
  return current === version ? confirmed : true
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

  // 401은 로그인하지 않은 것으로만 두고, 그 밖의 실패는 문구를 알린다. 회원 구분을 확인했는지 돌려준다
  restore(): Promise<boolean> {
    pendingRestore ??= readMember()
    return pendingRestore
  },

  // 라우터(PageGate)는 렌더 중에 읽은 회원 구분을 넘긴다
  canOpen(page: PageName, memberType: MemberType | null = state.member?.memberType ?? null): boolean {
    const access = pageAccess[page]
    return access === 'GUEST' ? memberType === null : access === memberType
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
  restore: async () => ({ confirmed: await AuthStore.restore(), memberType: AuthStore.memberType }),
})

export function useAuthState(): AuthState {
  return useSyncExternalStore(AuthStore.subscribe, AuthStore.getState)
}
