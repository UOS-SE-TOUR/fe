import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { memberTypes, pagePaths, type MemberType } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

// 설계의 form. 칸 이름은 be의 회원가입 요청(SignUpRequest)과 같다
interface SignUpForm {
  loginId: string
  password: string
  name: string
  address: string
  phone: string
  memberType: MemberType
  staffCode: string
}

const emptyForm: SignUpForm = {
  loginId: '',
  password: '',
  name: '',
  address: '',
  phone: '',
  memberType: 'CUSTOMER',
  staffCode: '',
}

const memberTypeOptions: { value: MemberType; label: string }[] = [
  { value: 'CUSTOMER', label: '고객' },
  { value: 'STAFF', label: '직원' },
]

function isMemberType(value: string): value is MemberType {
  return (memberTypes as readonly string[]).includes(value)
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<SignUpForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 입력을 바꾸면 앞의 실패 문구는 낡은 것이라 지운다
  function update<K extends keyof SignUpForm>(key: K, value: SignUpForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError(null)
  }

  function showSignUpResult() {
    toast.success('가입했습니다. 로그인해 주세요.')
    navigate(pagePaths.LoginPage, { replace: true })
  }

  async function submitSignUp({ staffCode, ...fields }: SignUpForm) {
    setSubmitting(true)
    setError(null)
    try {
      // 직원 코드는 직원으로 가입할 때만 보낸다(고객이면 서버도 보지 않는다)
      await ApiClient.post('/api/v1/members/signup', fields.memberType === 'STAFF' ? { ...fields, staffCode } : fields)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) setError(caught.message)
      else showError(caught)
      setSubmitting(false)
      return
    }
    showSignUpResult()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submitting) void submitSignUp(form)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">회원가입</h1>
          </CardTitle>
          <CardDescription>미스터 월드 테마 여행</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="signup-id">아이디</FieldLabel>
                <Input
                  id="signup-id"
                  autoComplete="username"
                  value={form.loginId}
                  onChange={(event) => update('loginId', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-password">비밀번호</FieldLabel>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="signup-password-help"
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                />
                <FieldDescription id="signup-password-help">8자 이상으로 입력해 주세요.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-name">성명</FieldLabel>
                <Input
                  id="signup-name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-address">주소</FieldLabel>
                <Input
                  id="signup-address"
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(event) => update('address', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-phone">연락처</FieldLabel>
                <Input
                  id="signup-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="010-1234-5678"
                  aria-describedby="signup-phone-help"
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                />
                <FieldDescription id="signup-phone-help">여행이 확정되면 이 휴대폰 번호로 문자를 보냅니다.</FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">회원 구분</FieldLegend>
                <RadioGroup
                  className="flex gap-6"
                  value={form.memberType}
                  onValueChange={(value) => {
                    if (isMemberType(value)) update('memberType', value)
                  }}
                >
                  {memberTypeOptions.map((option) => (
                    <Field key={option.value} orientation="horizontal" className="w-auto">
                      <RadioGroupItem id={`signup-member-type-${option.value}`} value={option.value} />
                      <FieldLabel htmlFor={`signup-member-type-${option.value}`} className="font-normal">
                        {option.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>
              {form.memberType === 'STAFF' && (
                <Field>
                  <FieldLabel htmlFor="signup-staff-code">직원 코드</FieldLabel>
                  <Input
                    id="signup-staff-code"
                    autoComplete="off"
                    aria-describedby="signup-staff-code-help"
                    value={form.staffCode}
                    onChange={(event) => update('staffCode', event.target.value)}
                  />
                  <FieldDescription id="signup-staff-code-help">회사에서 받은 직원 코드를 입력해 주세요.</FieldDescription>
                </Field>
              )}
              {error && <FieldError>{error}</FieldError>}
              <Button type="submit" disabled={submitting}>
                가입하기
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                이미 가입하셨나요?{' '}
                <Link to={pagePaths.LoginPage} className="text-primary underline-offset-4 hover:underline">
                  로그인
                </Link>
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
