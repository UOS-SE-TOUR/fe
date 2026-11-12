import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { clearFromLogin, markFromLogin } from '@/lib/fromLogin'
import { homePath, pagePaths, type MemberType } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'
import { AuthStore, isMember } from '@/modules/AuthStore'

export function LoginPage() {
  const navigate = useNavigate()
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function showMainPage(memberType: MemberType) {
    navigate(homePath(memberType), { replace: true })
  }

  async function logIn(loginId: string, rawPassword: string) {
    setSubmitting(true)
    setError(null)
    try {
      const body = await ApiClient.post('/api/v1/members/login', { loginId, password: rawPassword })
      if (!isMember(body)) throw new Error(`members/login 응답 모양이 다르다: ${JSON.stringify(body)}`)
      if (body.memberType === 'CUSTOMER') markFromLogin()
      else clearFromLogin()
      // 회원을 먼저 두어야 첫 화면이 로그인 화면으로 되돌려 보내지 않는다
      AuthStore.setMember(body.memberType, body.name)
      showMainPage(body.memberType)
    } catch (caught) {
      // 아이디·비밀번호가 틀리면 401이 아니라 400이다(설계 5.2)
      if (caught instanceof ApiError && caught.status === 400) setError(caught.message)
      else showError(caught)
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submitting) void logIn(id, password)
  }

  // 실패 문구는 아이디·비밀번호 어느 쪽이 틀렸는지 가리지 않아 두 칸 모두에 잇는다
  const errorProps = error ? { 'aria-invalid': true, 'aria-describedby': 'login-error' } : {}

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">로그인</h1>
          </CardTitle>
          <CardDescription>미스터 월드 테마 여행</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="login-id">아이디</FieldLabel>
                <Input
                  id="login-id"
                  autoComplete="username"
                  {...errorProps}
                  value={id}
                  onChange={(event) => {
                    setId(event.target.value)
                    setError(null)
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="login-password">비밀번호</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  {...errorProps}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                  }}
                />
              </Field>
              {error && <FieldError id="login-error">{error}</FieldError>}
              <Button type="submit" disabled={submitting}>
                로그인
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                처음이신가요?{' '}
                <Link to={pagePaths.SignUpPage} className="text-primary underline-offset-4 hover:underline">
                  회원가입
                </Link>
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
