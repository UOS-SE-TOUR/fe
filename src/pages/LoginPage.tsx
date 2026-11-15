import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { clearFromLogin, markFromLogin } from '@/lib/fromLogin'
import { themes } from '@/lib/labels'
import { homePath, pagePaths, type MemberType } from '@/lib/pages'
import { themeLooks } from '@/lib/themeLook'
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
    <main className="hero-scene flex flex-1 items-center justify-center p-6">
      <div className="grid w-full max-w-3xl items-center gap-10 lg:grid-cols-[1fr_auto]">
        <div className="hidden text-primary-foreground lg:block">
          <p className="text-4xl leading-tight font-bold tracking-tight">
            테마로 고르는
            <br />
            나만의 여행
          </p>
          <p className="mt-4 text-primary-foreground/90">네 가지 테마 여행을 만나 보세요.</p>
          <ul className="mt-6 flex max-w-sm flex-wrap gap-2">
            {themes.map((theme) => {
              const Icon = themeLooks[theme.value].icon
              return (
                <li
                  key={theme.value}
                  className="flex items-center gap-1.5 rounded-full bg-primary/60 px-3 py-1.5 text-sm backdrop-blur-sm"
                >
                  <Icon className="size-4" />
                  {theme.label}
                </li>
              )
            })}
          </ul>
        </div>
        <Card className="mx-auto w-full max-w-sm shadow-xl lg:w-96">
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
      </div>
    </main>
  )
}
