import { useSyncExternalStore } from 'react'
import { pageAccess, type PageName } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

export type MemberType = 'CUSTOMER' | 'STAFF'

// members/login·members/me 응답 본문
export interface Member {
  memberType: MemberType
  name: string
}

export interface AuthState {
  member: Member | null
  // restore가 서버 응답을 기다리는 중이면 true. 그동안은 화면을 막지 않는다(막으면 새로고침마다 로그인 화면으로 간다)
  restoring: boolean
}

let state: AuthState = { member: null, restoring: false }
// setMember·clear·새 restore가 오면 늘어난다. 늦게 끝난 restore가 그 뒤의 상태를 덮어쓰지 않게 한다
let version = 0
const listeners = new Set<() => void>()

function setState(next: AuthState) {
  state = next
  listeners.forEach((listener) => listener())
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
    setState({ member: { memberType, name }, restoring: false })
  },

  // 새로고침 뒤 로그인 상태를 되살린다. 401은 로그인하지 않은 것으로만 두고, 그 밖의 실패도 로그인하지 않은 것으로 두되 문구를 알린다
  async restore(): Promise<void> {
    const current = ++version
    setState({ ...state, restoring: true })
    let member: Member | null = null
    try {
      member = await ApiClient.get<Member>('/api/v1/members/me', { handleAuthErrors: false })
    } catch (error) {
      if (current === version && !(error instanceof ApiError && error.status === 401)) showError(error)
    }
    if (current !== version) return
    setState({ member, restoring: false })
  },

  canOpen(page: PageName): boolean {
    const access = pageAccess[page]
    const memberType = state.member?.memberType ?? null
    return access === 'GUEST' ? memberType === null : access === memberType
  },

  clear() {
    version += 1
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

export function useAuthState(): AuthState {
  return useSyncExternalStore(AuthStore.subscribe, AuthStore.getState)
}
