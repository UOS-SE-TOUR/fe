import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { memberTypeLabels } from '@/lib/labels'
import { isMemberType, memberTypes, pagePaths, type MemberType } from '@/lib/pages'
import { editPhoneNumber, type PhoneNumberSelection } from '@/lib/phoneNumber'
import { AddressSearch } from '@/modules/AddressSearch'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

// 설계의 form. 상세 주소(addressDetail) 말고는 칸 이름이 be의 회원가입 요청(SignUpRequest)과 같다
interface SignUpForm {
  loginId: string
  password: string
  name: string
  address: string
  addressDetail: string
  phone: string
  memberType: MemberType
  staffCode: string
}

const emptyForm: SignUpForm = {
  loginId: '',
  password: '',
  name: '',
  address: '',
  addressDetail: '',
  phone: '',
  memberType: 'CUSTOMER',
  staffCode: '',
}

const ADDRESS_SEARCH_FAILED_MESSAGE = '주소 검색을 불러오지 못했습니다. 주소를 직접 입력해 주세요.'

// 서버는 주소를 한 칸으로 받는다. 주소가 없으면 상세 주소만 보내지 않고 비워 서버가 주소를 달라고 하게 둔다
function joinAddress(address: string, detail: string): string {
  const base = address.trim()
  const rest = detail.trim()
  return base && rest ? `${base} ${rest}` : base
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<SignUpForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)
  const [addressSearchOpen, setAddressSearchOpen] = useState(false)
  // 열 때마다 검색 자리를 새로 만든다. 닫히는 중에 다시 열어 남은 자리를 그대로 쓰면, 주소를 고르며 비워진 자리라 빈 팝업이 된다
  const [addressSearchCount, setAddressSearchCount] = useState(0)
  const [addressSearchFailed, setAddressSearchFailed] = useState(false)
  // 우편번호 서비스를 불러오지 못하면 주소를 직접 입력하게 연다. 다시 불러와도 검색에서 주소를 고르기 전까지는 연 채로 둔다
  const [addressByHand, setAddressByHand] = useState(false)
  const addressInput = useRef<HTMLInputElement>(null)
  const addressDetailInput = useRef<HTMLInputElement>(null)
  const addressSearchButton = useRef<HTMLButtonElement>(null)
  const addressSearchTarget = useRef<HTMLElement | null>(null)
  const addressSelected = useRef(false)
  const phoneInput = useRef<HTMLInputElement>(null)
  const phoneSelectionBefore = useRef<PhoneNumberSelection | undefined>(undefined)

  // 입력 전에 고른 범위는 input 이벤트로 알 수 없어 beforeinput에서 적는다(React onBeforeInput은 지우기에 오지 않는다)
  useEffect(() => {
    const input = phoneInput.current
    if (!input) return
    const note = () => {
      const selection = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 }
      phoneSelectionBefore.current = selection
      // 그 입력이 끝나면 버린다. input이 오지 않거나 React가 onChange를 건너뛰어도 다음 입력에 남지 않게
      setTimeout(() => {
        if (phoneSelectionBefore.current === selection) phoneSelectionBefore.current = undefined
      })
    }
    input.addEventListener('beforeinput', note)
    return () => input.removeEventListener('beforeinput', note)
  }, [])

  // 입력을 바꾸면 앞의 실패 문구는 낡은 것이라 지운다
  function update<K extends keyof SignUpForm>(key: K, value: SignUpForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError(null)
  }

  // 연락처 칸의 값과 커서를 여기서 바로 맞춘다. React가 값만 바꾸면 커서가 끝으로 튄다
  function updatePhone(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const { inputType } = event.nativeEvent as Partial<InputEvent>
    const caret = input.selectionStart ?? input.value.length
    const next = editPhoneNumber(form.phone, input.value, caret, inputType, phoneSelectionBefore.current)
    if (input.value !== next.value) input.value = next.value
    // 자동 완성은 초점 없는 칸에도 값을 넣으니, 초점을 끌어오지 않게 커서는 초점이 있을 때만 둔다
    if (document.activeElement === input) input.setSelectionRange(next.caret, next.selectionEnd ?? next.caret)
    if (next.rejected) toast.info('휴대폰 번호는 11자리까지 입력할 수 있습니다.', { id: 'signup-phone-max-digits' })
    if (next.value !== form.phone) update('phone', next.value)
  }

  async function openAddressSearch() {
    setAddressSearchLoading(true)
    // 다시 실패해도 화면 낭독기가 읽게, 불러오는 동안은 실패 문구를 비운다
    setAddressSearchFailed(false)
    try {
      await AddressSearch.load()
    } catch {
      setAddressSearchFailed(true)
      setAddressByHand(true)
      // 기다리는 사이 다른 칸으로 옮겼으면 초점을 빼앗지 않는다(막힌 단추에 있던 초점은 body로 풀린다)
      const focused = document.activeElement
      if (!focused || focused === document.body || focused === addressSearchButton.current) addressInput.current?.focus()
      return
    } finally {
      setAddressSearchLoading(false)
    }
    addressSelected.current = false
    setAddressSearchCount((count) => count + 1)
    setAddressSearchOpen(true)
  }

  // 팝업이 열려 검색 화면 자리가 생기면 띄운다. StrictMode는 같은 자리에 ref를 두 번 붙이니 이미 띄운 자리는 그대로 둔다
  const showAddressSearch = useCallback((element: HTMLDivElement | null) => {
    if (!element || element === addressSearchTarget.current) return
    addressSearchTarget.current = element
    AddressSearch.embed(element, (address) => {
      setForm((current) => ({ ...current, address }))
      setError(null)
      setAddressByHand(false)
      addressSelected.current = true
      setAddressSearchOpen(false)
    })
  }, [])

  // 주소를 골라 닫으면 상세 주소를 바로 치게 하고, 그냥 닫으면 "주소 검색" 단추로 돌아간다.
  // 불러오는 동안 단추를 막아 초점이 풀리므로 팝업이 스스로 돌려보낼 자리가 없다
  function focusAfterAddressSearch(event: Event) {
    event.preventDefault()
    if (addressSelected.current) addressDetailInput.current?.focus()
    else addressSearchButton.current?.focus()
  }

  function showSignUpResult() {
    toast.success('가입했습니다. 로그인해 주세요.')
    navigate(pagePaths.LoginPage, { replace: true })
  }

  async function submitSignUp({ staffCode, addressDetail, ...fields }: SignUpForm) {
    setSubmitting(true)
    setError(null)
    const request = { ...fields, address: joinAddress(fields.address, addressDetail) }
    try {
      // 직원 코드는 직원으로 가입할 때만 보낸다(고객이면 서버도 보지 않는다)
      await ApiClient.post('/api/v1/members/signup', request.memberType === 'STAFF' ? { ...request, staffCode } : request)
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
                <div className="flex gap-2">
                  <Input
                    id="signup-address"
                    autoComplete="address-line1"
                    readOnly={!addressByHand}
                    placeholder={addressByHand ? undefined : '주소 검색으로 찾아 주세요'}
                    aria-describedby={addressSearchFailed ? 'signup-address-help' : undefined}
                    value={form.address}
                    ref={addressInput}
                    onChange={(event) => update('address', event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={addressSearchLoading}
                    ref={addressSearchButton}
                    onClick={() => void openAddressSearch()}
                  >
                    주소 검색
                  </Button>
                </div>
                {addressSearchFailed && (
                  <FieldDescription id="signup-address-help">{ADDRESS_SEARCH_FAILED_MESSAGE}</FieldDescription>
                )}
                {/* 화면 낭독기는 미리 있던 알림 자리에 새로 든 글자만 읽어 준다 */}
                <p role="status" className="sr-only">
                  {addressSearchFailed ? ADDRESS_SEARCH_FAILED_MESSAGE : ''}
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-address-detail">상세 주소</FieldLabel>
                <Input
                  id="signup-address-detail"
                  autoComplete="address-line2"
                  aria-describedby="signup-address-detail-help"
                  value={form.addressDetail}
                  ref={addressDetailInput}
                  onChange={(event) => update('addressDetail', event.target.value)}
                />
                <FieldDescription id="signup-address-detail-help">
                  동·호수 같은 나머지 주소를 입력해 주세요. 없으면 비워 둡니다.
                </FieldDescription>
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
                  ref={phoneInput}
                  onChange={updatePhone}
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
                  {memberTypes.map((memberType) => (
                    <Field key={memberType} orientation="horizontal" className="w-auto">
                      <RadioGroupItem id={`signup-member-type-${memberType}`} value={memberType} />
                      <FieldLabel htmlFor={`signup-member-type-${memberType}`} className="font-normal">
                        {memberTypeLabels[memberType]}
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
      {/* 검색 화면은 폭 300px·높이 400px 이상이어야 하고, 아래 카카오 로고가 가려지면 안 된다.
          좁은 휴대폰에선 검색 자리를 팝업 좌우 끝까지 넓히고, 낮은 화면에선 팝업을 굴려 본다 */}
      <Dialog open={addressSearchOpen} onOpenChange={setAddressSearchOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100svh-2rem)] max-w-[calc(100%-1rem)] gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-6"
          onCloseAutoFocus={focusAfterAddressSearch}
        >
          <DialogHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <DialogTitle>주소 검색</DialogTitle>
              <DialogDescription>도로명·건물명·지번으로 찾은 뒤, 나온 주소를 누르면 주소 칸에 들어갑니다.</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="닫기">
                <XIcon />
              </Button>
            </DialogClose>
          </DialogHeader>
          <div key={addressSearchCount} ref={showAddressSearch} className="-mx-4 h-[clamp(400px,calc(100svh-10rem),500px)] sm:mx-0" />
        </DialogContent>
      </Dialog>
    </main>
  )
}
