import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { toast } from 'sonner'

// 공통 헤더에서도 서버 로그아웃 요청을 보내기 전에 진행 중인 중요 작업을 확인한다.
const pendingActions = new Map<symbol, string>()

export function getBlockingMessage(): string | null {
  return pendingActions.values().next().value ?? null
}

// 두 번 처리되면 안 되는 요청을 보내는 동안 떠나면 처리됐는지 모른 채 다시 보낼 수 있으니,
// blocking인 동안 화면 이동(뒤로 가기 포함)을 막아 message를 알리고 탭 닫기는 브라우저가 떠날지 묻게 한다
export function useBlockLeaving(blocking: boolean, message: string) {
  const blocker = useBlocker(blocking)
  useEffect(() => {
    if (!blocking) return
    const id = Symbol('pending-action')
    pendingActions.set(id, message)
    return () => {
      pendingActions.delete(id)
    }
  }, [blocking, message])
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    toast.info(message, { id: 'leave-blocked' })
    blocker.reset()
  }, [blocker, message])
  useEffect(() => {
    if (!blocking) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // 옛 브라우저는 이 값이 있어야 떠나기 확인 창을 띄운다
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [blocking])
}
