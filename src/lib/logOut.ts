import { useState } from 'react'
import { useNavigate } from 'react-router'
import { clearFromLogin } from '@/lib/fromLogin'
import { pagePaths } from '@/lib/pages'
import { ApiClient, showError } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'

// 고객·직원 첫 화면의 로그아웃(설계 logOut·showLoginPage). 로그인 쿠키는 HttpOnly라 서버만 지울 수 있어,
// 요청이 실패하면 문구만 보여 주고 로그인 상태를 그대로 둔다
export function useLogOut() {
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  function showLoginPage() {
    navigate(pagePaths.LoginPage, { replace: true })
  }

  async function logOut() {
    setLoggingOut(true)
    try {
      await ApiClient.post('/api/v1/members/logout')
    } catch (error) {
      showError(error)
      setLoggingOut(false)
      return
    }
    clearFromLogin()
    AuthStore.clear()
    showLoginPage()
  }

  return { logOut, loggingOut }
}
