import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useBlocker } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { themeLabel, themes, tourLevelLabel, tourLevels, type Theme, type TourLevel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

// 허니문·효도 투어는 그랜드와 프리미엄만 판다(be Theme.allows)
const grandAndPremiumOnly: readonly Theme[] = ['HONEYMOON', 'PARENTS']

// be가 읽는 범위(기간·정원은 Java int, 가격·추가 요금은 Java long을 JavaScript가 정확히 담는 데까지). 넘으면 본문을 읽지 못해 400이다
const INT_RANGE = { min: -2_147_483_648, max: 2_147_483_647 }
const SAFE_LONG_RANGE = { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }

interface TransportRow {
  id: number
  name: string
  unitPrice: string
}

interface TourForm {
  theme: Theme | ''
  departureDate: string
  duration: string
  capacity: string
  prices: Record<TourLevel, string>
  transports: TransportRow[]
}

interface FormErrors {
  theme?: string
  departureDate?: string
  duration?: string
  capacity?: string
  prices: Partial<Record<TourLevel, string>>
  transports: Record<number, { name?: string; unitPrice?: string }>
}

// be RegisterTourRequest
interface RegisterTourRequest {
  theme: Theme
  departureDate: string
  duration: number
  capacity: number
  prices: { level: TourLevel; price: number }[]
  transports: { name: string; unitPrice: number }[]
}

let nextTransportId = 0

function newTransport(): TransportRow {
  return { id: nextTransportId++, name: '', unitPrice: '' }
}

function emptyForm(): TourForm {
  return {
    theme: '',
    departureDate: '',
    duration: '',
    capacity: '',
    prices: { CLASSIC: '', GRAND: '', PREMIUM: '' },
    transports: [newTransport()],
  }
}

function levelsOf(theme: Theme): TourLevel[] {
  return tourLevels
    .map((level) => level.value)
    .filter((level) => level !== 'CLASSIC' || !grandAndPremiumOnly.includes(theme))
}

// 전각 숫자·부호·쉼표(한글 입력기)를 반각으로 바꾼다
function toHalfWidth(text: string): string {
  return text.replace(/[０-９－，]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

// 세 자리마다 쉼표를 찍은 수(1,500,000)도 받는다. name은 받침으로 끝나는 칸 이름이다(기간, 정원, 가격, 추가 요금)
function parseInteger(
  text: string,
  name: string,
  range: { min: number; max: number },
): { ok: true; value: number } | { ok: false; error: string } {
  const normalized = toHalfWidth(text).trim()
  if (normalized === '') return { ok: false, error: `${name}을 입력해 주세요.` }
  if (!/^-?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)$/.test(normalized)) {
    return { ok: false, error: `${name}은 정수로 입력해 주세요.` }
  }
  const value = Number(normalized.replace(/,/g, ''))
  if (value < range.min || value > range.max) return { ok: false, error: `${name}은 입력할 수 있는 범위를 넘었습니다.` }
  return { ok: true, value }
}

function hasErrors({ prices, transports, ...fields }: FormErrors): boolean {
  return Object.values(fields).some(Boolean) || Object.keys(prices).length > 0 || Object.keys(transports).length > 0
}

// 빈 칸과 정수가 아닌 값만 막는다. 그 밖의 규칙(기본 교통, 정원, 출발일 등)은 서버의 400 문구를 보여 준다
function validate(form: TourForm): { errors: FormErrors; request: RegisterTourRequest | null } {
  const errors: FormErrors = { prices: {}, transports: {} }

  if (form.theme === '') errors.theme = '테마를 골라 주세요.'
  // 날짜 칸은 날짜가 아니면 빈 값을 준다. 네 자리를 넘는 연도는 be가 읽지 못한다
  // 연·월·일 가운데 하나라도 비었거나 없는 날짜(2월 30일 등)도 빈 값이다
  if (form.departureDate === '') errors.departureDate = '출발일을 연·월·일까지 맞게 입력해 주세요.'
  else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(form.departureDate)) {
    errors.departureDate = '출발일을 9999년 12월 31일까지의 날짜로 입력해 주세요.'
  }

  const duration = parseInteger(form.duration, '기간', INT_RANGE)
  if (!duration.ok) errors.duration = duration.error
  const capacity = parseInteger(form.capacity, '정원', INT_RANGE)
  if (!capacity.ok) errors.capacity = capacity.error

  const prices: RegisterTourRequest['prices'] = []
  if (form.theme !== '') {
    for (const level of levelsOf(form.theme)) {
      const price = parseInteger(form.prices[level], `${tourLevelLabel(level)} 가격`, SAFE_LONG_RANGE)
      if (price.ok) prices.push({ level, price: price.value })
      else errors.prices[level] = price.error
    }
  }

  const transports: RegisterTourRequest['transports'] = []
  for (const row of form.transports) {
    const name = row.name.trim()
    const nameError = name === '' ? '교통 이름을 입력해 주세요.' : undefined
    const unitPrice = parseInteger(row.unitPrice, '추가 요금', SAFE_LONG_RANGE)
    if (!nameError && unitPrice.ok) transports.push({ name, unitPrice: unitPrice.value })
    else errors.transports[row.id] = { name: nameError, unitPrice: unitPrice.ok ? undefined : unitPrice.error }
  }

  if (hasErrors(errors) || form.theme === '' || !duration.ok || !capacity.ok) {
    return { errors, request: null }
  }
  return {
    errors,
    request: {
      theme: form.theme,
      departureDate: form.departureDate,
      duration: duration.value,
      capacity: capacity.value,
      prices,
      transports,
    },
  }
}

// 막힌 칸 가운데 화면에서 가장 먼저 나오는 칸의 id
function firstInvalidId(form: TourForm, errors: FormErrors): string | null {
  if (errors.theme) return `theme-${themes[0].value}`
  for (const id of ['departureDate', 'duration', 'capacity'] as const) {
    if (errors[id]) return id
  }
  const level = tourLevels.map(({ value }) => value).find((value) => errors.prices[value])
  if (level) return `price-${level}`
  for (const row of form.transports) {
    const rowErrors = errors.transports[row.id]
    if (rowErrors?.name) return `transport-${row.id}-name`
    if (rowErrors?.unitPrice) return `transport-${row.id}-price`
  }
  return null
}

function tourIdOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('tourId' in body)) return null
  return typeof body.tourId === 'number' ? body.tourId : null
}

const noErrors: FormErrors = { prices: {}, transports: {} }

// 칸 설명과, 칸이 막혔으면 그 이유 문구(BlockedReason)를 칸에 잇는다
function describedBy(fieldId: string, error: string | undefined, hintId?: string): string | undefined {
  return [hintId, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined
}

// 칸마다 막은 이유. 초점과 aria-describedby로 칸과 함께 읽히니, 고칠 때마다 다시 낭독되지 않게 알림(role=alert)으로 두지 않는다
function BlockedReason({ fieldId, children }: { fieldId: string; children?: string }) {
  if (!children) return null
  return (
    <p id={`${fieldId}-error`} className="text-sm font-normal text-destructive">
      {children}
    </p>
  )
}

// 요청이 끝나 막았던 칸·단추가 풀렸는데 초점이 빠져 있는지
function focusLost(): boolean {
  const active = document.activeElement
  return !active || active === document.body || active.matches(':disabled')
}

export function TourPlanPage() {
  const [form, setForm] = useState(emptyForm)
  // 등록을 한 번 누른 뒤부터 칸마다 막은 이유를 보여 준다
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // 상품이 이미 생겼을 수 있어 등록 단추를 다시 열지 않는다(직원용 상품 목록 API가 없어 다시 읽을 수 없다)
  const [resultUnknown, setResultUnknown] = useState(false)
  // 등록했다. 성공 응답에 상품 번호가 없으면 tourId가 null
  const [registered, setRegistered] = useState<{ tourId: number | null } | null>(null)
  // 단추가 막히기 전에 두 번 눌러도 한 번만 보낸다
  const submittingRef = useRef(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  const unknownHintRef = useRef<HTMLParagraphElement>(null)
  const addTransportRef = useRef<HTMLButtonElement>(null)

  // 보내는 동안 떠나면 등록됐는지 알 수 없으니 화면 이동(뒤로 가기 포함)과 탭 닫기를 막는다
  const blocker = useBlocker(submitting)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    toast.info('등록이 끝날 때까지 이 화면에 있어 주세요.', { id: 'tour-plan-leave' })
    blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!submitting) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // 옛 브라우저는 이 값이 있어야 떠나기 확인 창을 띄운다
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [submitting])

  const validation = useMemo(() => validate(form), [form])
  const errors = submitted ? validation.errors : noErrors
  const classicHidden = form.theme !== '' && grandAndPremiumOnly.includes(form.theme)
  const priceHintId = classicHidden ? 'price-hint' : undefined

  // 입력을 고치면 지난 서버 문구를 지운다. 처리됐는지 모르는 실패의 문구는 남긴다
  function edit(change: (current: TourForm) => TourForm) {
    setForm(change)
    if (!resultUnknown) setMessage(null)
  }

  function update(patch: Partial<TourForm>) {
    edit((current) => ({ ...current, ...patch }))
  }

  function updatePrice(level: TourLevel, price: string) {
    edit((current) => ({ ...current, prices: { ...current.prices, [level]: price } }))
  }

  function updateTransport(id: number, patch: Partial<TransportRow>) {
    edit((current) => ({
      ...current,
      transports: current.transports.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }))
  }

  function addTransport() {
    const row = newTransport()
    edit((current) => ({ ...current, transports: [...current.transports, row] }))
  }

  // 누른 빼기 단추가 줄과 함께 사라지니 초점을 더하기 단추로 옮긴다
  function removeTransport(id: number) {
    flushSync(() => edit((current) => ({ ...current, transports: current.transports.filter((row) => row.id !== id) })))
    if (focusLost()) addTransportRef.current?.focus()
  }

  function showRegisterResult(tourId: number | null) {
    setRegistered({ tourId })
  }

  function showRegisterFailure(error: unknown) {
    if (error instanceof ApiError) {
      if (error.resultUnknown) setResultUnknown(true)
      if (!error.handled) setMessage(error.message)
    } else {
      showError(error)
    }
  }

  // 누른 다른 상품 기획하기 단추가 결과와 함께 사라지니 초점을 새 입력 화면의 첫 칸으로 옮긴다
  function showTourForm() {
    flushSync(() => {
      setForm(emptyForm())
      setSubmitted(false)
      setMessage(null)
      setRegistered(null)
    })
    document.getElementById(`theme-${themes[0].value}`)?.focus()
  }

  async function registerTour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || resultUnknown) return
    // 칸에 막은 이유(aria-describedby)를 먼저 그린 뒤 초점을 옮긴다
    flushSync(() => {
      setSubmitted(true)
      setMessage(null)
    })
    const { request, errors: blocked } = validation
    if (!request) {
      const id = firstInvalidId(form, blocked)
      if (id) document.getElementById(id)?.focus()
      return
    }

    // 마우스로 누르면 단추에 초점을 주지 않는 브라우저(Safari 등)에서는 돌아갈 곳이 없다
    const active = document.activeElement
    const returnTo = active instanceof HTMLElement && active !== document.body ? active : null
    submittingRef.current = true
    setSubmitting(true)
    const settle = await ApiClient.post('/api/v1/staff/tours', request, { unsafeToRetry: true }).then(
      (body) => () => showRegisterResult(tourIdOf(body)),
      (error: unknown) => () => showRegisterFailure(error),
    )
    submittingRef.current = false
    // 결과와 풀린 칸·단추를 한 번에 그린 뒤 빠진 초점을 되돌린다. 등록 단추가 계속 막히면(처리됐는지 모름) 그 안내로 옮긴다
    // (서버 문구는 알림으로 이미 읽히니 초점을 주지 않는다)
    flushSync(() => {
      settle()
      setSubmitting(false)
    })
    if (focusLost()) {
      const target = [returnTo, submitRef.current, unknownHintRef.current].find(
        (element) => element?.isConnected && !element.matches(':disabled'),
      )
      target?.focus()
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">상품 기획</h1>
        {submitting ? (
          <Button variant="outline" disabled>
            직원 첫 화면으로
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link to={pagePaths.StaffMainPage}>직원 첫 화면으로</Link>
          </Button>
        )}
      </header>

      {registered ? (
        <Card role="status">
          <CardHeader>
            <CardTitle id="registered-title">상품을 등록했습니다</CardTitle>
            <CardDescription id="registered-detail">
              {registered.tourId === null ? '상품 번호를 받지 못했습니다.' : `상품 번호 ${registered.tourId}`}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            {/* 눌렀던 등록 단추가 사라지니 다음 단추로 옮긴다 */}
            <Button autoFocus aria-describedby="registered-title registered-detail" onClick={showTourForm}>
              다른 상품 기획하기
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <form noValidate onSubmit={registerTour} className="flex flex-col gap-8">
          {/* 보내는 동안 고친 값은 등록되지 않으니 입력을 막는다 */}
          <fieldset disabled={submitting} className="min-w-0">
            <FieldGroup>
              <FieldSet data-invalid={!!errors.theme}>
                <FieldLegend>테마</FieldLegend>
                <RadioGroup
                  value={form.theme}
                  onValueChange={(theme) => update({ theme: theme as Theme })}
                  aria-describedby={describedBy('theme', errors.theme)}
                  className="sm:grid-cols-2"
                >
                  {themes.map((theme) => (
                    <Field key={theme.value} orientation="horizontal">
                      <RadioGroupItem value={theme.value} id={`theme-${theme.value}`} aria-invalid={!!errors.theme} />
                      <FieldLabel htmlFor={`theme-${theme.value}`} className="font-normal">
                        {theme.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
                <BlockedReason fieldId="theme">{errors.theme}</BlockedReason>
              </FieldSet>

              <Field data-invalid={!!errors.departureDate}>
                <FieldLabel htmlFor="departureDate">출발일</FieldLabel>
                <Input
                  id="departureDate"
                  type="date"
                  max="9999-12-31"
                  value={form.departureDate}
                  onChange={(event) => update({ departureDate: event.target.value })}
                  aria-invalid={!!errors.departureDate}
                  aria-describedby={describedBy('departureDate', errors.departureDate)}
                />
                <BlockedReason fieldId="departureDate">{errors.departureDate}</BlockedReason>
              </Field>

              <div className="grid gap-7 sm:grid-cols-2">
                <Field data-invalid={!!errors.duration}>
                  <FieldLabel htmlFor="duration">기간(일)</FieldLabel>
                  <Input
                    id="duration"
                    inputMode="numeric"
                    value={form.duration}
                    onChange={(event) => update({ duration: event.target.value })}
                    aria-invalid={!!errors.duration}
                    aria-describedby={describedBy('duration', errors.duration)}
                  />
                  <BlockedReason fieldId="duration">{errors.duration}</BlockedReason>
                </Field>
                <Field data-invalid={!!errors.capacity}>
                  <FieldLabel htmlFor="capacity">정원(명)</FieldLabel>
                  <Input
                    id="capacity"
                    inputMode="numeric"
                    value={form.capacity}
                    onChange={(event) => update({ capacity: event.target.value })}
                    aria-invalid={!!errors.capacity}
                    aria-describedby={describedBy('capacity', errors.capacity, 'capacity-hint')}
                  />
                  <FieldDescription id="capacity-hint">3명 이상, 허니문 낭만 투어는 짝수</FieldDescription>
                  <BlockedReason fieldId="capacity">{errors.capacity}</BlockedReason>
                </Field>
              </div>

              <FieldSet>
                <FieldLegend>투어 등급별 1인 가격(원)</FieldLegend>
                {form.theme === '' ? (
                  <FieldDescription>테마를 고르면 가격을 입력할 투어 등급이 나옵니다.</FieldDescription>
                ) : (
                  <>
                    {classicHidden && (
                      <FieldDescription id="price-hint">{`${themeLabel(form.theme)}는 그랜드와 프리미엄 가격만 받습니다.`}</FieldDescription>
                    )}
                    <div className="grid gap-4 sm:grid-cols-3">
                      {levelsOf(form.theme).map((level) => (
                        <Field key={level} data-invalid={!!errors.prices[level]}>
                          <FieldLabel htmlFor={`price-${level}`}>{tourLevelLabel(level)}</FieldLabel>
                          <Input
                            id={`price-${level}`}
                            inputMode="numeric"
                            value={form.prices[level]}
                            onChange={(event) => updatePrice(level, event.target.value)}
                            aria-invalid={!!errors.prices[level]}
                            aria-describedby={describedBy(
                              `price-${level}`,
                              errors.prices[level],
                              priceHintId,
                            )}
                          />
                          <BlockedReason fieldId={`price-${level}`}>{errors.prices[level]}</BlockedReason>
                        </Field>
                      ))}
                    </div>
                  </>
                )}
              </FieldSet>

              <FieldSet>
                <FieldLegend>교통 선택지</FieldLegend>
                <FieldDescription id="transport-hint">
                  1인 추가 요금이 0원인 기본 교통을 하나 넣고, 다른 교통에는 기본 교통보다 더 받는 1인 요금을 적습니다.
                </FieldDescription>
                {form.transports.map((row, index) => {
                  const rowErrors = errors.transports[row.id]
                  return (
                    <div key={row.id} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
                      <Field data-invalid={!!rowErrors?.name}>
                        <FieldLabel htmlFor={`transport-${row.id}-name`}>{`교통 ${index + 1} 이름`}</FieldLabel>
                        <Input
                          id={`transport-${row.id}-name`}
                          value={row.name}
                          onChange={(event) => updateTransport(row.id, { name: event.target.value })}
                          aria-invalid={!!rowErrors?.name}
                          aria-describedby={describedBy(`transport-${row.id}-name`, rowErrors?.name)}
                        />
                        <BlockedReason fieldId={`transport-${row.id}-name`}>{rowErrors?.name}</BlockedReason>
                      </Field>
                      <Field data-invalid={!!rowErrors?.unitPrice}>
                        <FieldLabel htmlFor={`transport-${row.id}-price`}>{`교통 ${index + 1} 1인 추가 요금(원)`}</FieldLabel>
                        <Input
                          id={`transport-${row.id}-price`}
                          inputMode="numeric"
                          value={row.unitPrice}
                          onChange={(event) => updateTransport(row.id, { unitPrice: event.target.value })}
                          aria-invalid={!!rowErrors?.unitPrice}
                          aria-describedby={describedBy(`transport-${row.id}-price`, rowErrors?.unitPrice, 'transport-hint')}
                        />
                        <BlockedReason fieldId={`transport-${row.id}-price`}>{rowErrors?.unitPrice}</BlockedReason>
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        className="sm:mt-6"
                        aria-label={`교통 ${index + 1} 빼기`}
                        disabled={form.transports.length === 1}
                        onClick={() => removeTransport(row.id)}
                      >
                        빼기
                      </Button>
                    </div>
                  )
                })}
                <Button ref={addTransportRef} type="button" variant="outline" className="self-start" onClick={addTransport}>
                  교통 선택지 더하기
                </Button>
              </FieldSet>
            </FieldGroup>
          </fieldset>

          <div className="flex flex-col gap-3">
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            {resultUnknown && (
              <p ref={unknownHintRef} tabIndex={-1} className="text-sm text-muted-foreground outline-none">
                이 화면에서는 상품이 등록됐는지 확인할 수 없어 등록 단추를 막았습니다. 같은 상품이 이미 등록됐을 수
                있습니다. 그래도 다시 등록하려면 화면을 새로 여세요.
              </p>
            )}
            <Button ref={submitRef} type="submit" className="self-start" disabled={submitting || resultUnknown}>
              {submitting ? '등록하는 중…' : '등록'}
            </Button>
          </div>
        </form>
      )}
    </main>
  )
}
