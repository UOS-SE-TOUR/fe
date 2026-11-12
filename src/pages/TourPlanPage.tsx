import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { themeLabel, themes, tourLevelLabel, tourLevels, type Theme, type TourLevel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

// 허니문·효도 투어는 그랜드와 프리미엄만 판다(be Theme.allows)
const grandAndPremiumOnly: readonly Theme[] = ['HONEYMOON', 'PARENTS']

// be가 읽는 범위(기간·정원은 Java int, 가격·추가 요금은 Java long을 JavaScript가 정확히 담는 데까지). 넘으면 본문을 읽지 못해 400이다
const INT_MAX = 2_147_483_647
const SAFE_LONG_MAX = Number.MAX_SAFE_INTEGER

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
function parseInteger(text: string, name: string, max: number): { value?: number; error?: string } {
  const normalized = toHalfWidth(text).trim()
  if (normalized === '') return { error: `${name}을 입력해 주세요.` }
  if (!/^-?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)$/.test(normalized)) return { error: `${name}은 정수로 입력해 주세요.` }
  const value = Number(normalized.replace(/,/g, ''))
  if (Math.abs(value) > max) return { error: `${name}은 입력할 수 있는 범위를 넘었습니다.` }
  return { value }
}

function hasErrors({ prices, transports, ...fields }: FormErrors): boolean {
  return Object.values(fields).some(Boolean) || Object.keys(prices).length > 0 || Object.keys(transports).length > 0
}

// 빈 칸과 정수가 아닌 값만 막는다. 그 밖의 규칙(기본 교통, 정원, 출발일 등)은 서버의 400 문구를 보여 준다
function validate(form: TourForm): { errors: FormErrors; request: RegisterTourRequest | null } {
  const errors: FormErrors = { prices: {}, transports: {} }

  if (form.theme === '') errors.theme = '테마를 골라 주세요.'
  // 날짜 칸은 날짜가 아니면 빈 값을 준다. 네 자리를 넘는 연도는 be가 읽지 못한다
  if (form.departureDate === '') errors.departureDate = '출발일을 입력해 주세요.'
  else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(form.departureDate)) {
    errors.departureDate = '출발일을 9999년 12월 31일까지의 날짜로 입력해 주세요.'
  }

  const duration = parseInteger(form.duration, '기간', INT_MAX)
  errors.duration = duration.error
  const capacity = parseInteger(form.capacity, '정원', INT_MAX)
  errors.capacity = capacity.error

  const prices: RegisterTourRequest['prices'] = []
  if (form.theme !== '') {
    for (const level of levelsOf(form.theme)) {
      const price = parseInteger(form.prices[level], `${tourLevelLabel(level)} 가격`, SAFE_LONG_MAX)
      if (price.error) errors.prices[level] = price.error
      else if (price.value !== undefined) prices.push({ level, price: price.value })
    }
  }

  const transports: RegisterTourRequest['transports'] = []
  for (const row of form.transports) {
    const name = row.name.trim()
    const nameError = name === '' ? '교통 이름을 입력해 주세요.' : undefined
    const unitPrice = parseInteger(row.unitPrice, '추가 요금', SAFE_LONG_MAX)
    if (nameError || unitPrice.error) errors.transports[row.id] = { name: nameError, unitPrice: unitPrice.error }
    else if (unitPrice.value !== undefined) transports.push({ name, unitPrice: unitPrice.value })
  }

  if (hasErrors(errors) || form.theme === '' || duration.value === undefined || capacity.value === undefined) {
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

// 칸이 막혔으면 그 이유 문구(FieldError id)를 칸에 잇는다
function errorIdOf(id: string, error: string | undefined): string | undefined {
  return error ? `${id}-error` : undefined
}

export function TourPlanPage() {
  const [form, setForm] = useState(emptyForm)
  // 등록을 한 번 누른 뒤부터 칸마다 막은 이유를 보여 준다
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // 상품이 이미 생겼을 수 있어 등록 단추를 다시 열지 않는다(직원용 상품 목록 API가 없어 다시 읽을 수 없다)
  const [resultUnknown, setResultUnknown] = useState(false)
  // 등록했다. 성공 응답에서 상품 번호를 읽지 못했으면 tourId가 null
  const [registered, setRegistered] = useState<{ tourId: number | null } | null>(null)
  // 단추가 막히기 전에 두 번 눌러도 한 번만 보낸다
  const submittingRef = useRef(false)

  const validation = useMemo(() => validate(form), [form])
  const errors = submitted ? validation.errors : noErrors

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
    edit((current) => ({ ...current, transports: [...current.transports, newTransport()] }))
  }

  function removeTransport(id: number) {
    edit((current) => ({ ...current, transports: current.transports.filter((row) => row.id !== id) }))
  }

  function showRegisterResult(tourId: number | null) {
    setRegistered({ tourId })
  }

  function showTourForm() {
    setForm(emptyForm())
    setSubmitted(false)
    setMessage(null)
    setRegistered(null)
  }

  async function registerTour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || resultUnknown) return
    setSubmitted(true)
    setMessage(null)
    const { request, errors: blocked } = validation
    if (!request) {
      const id = firstInvalidId(form, blocked)
      if (id) document.getElementById(id)?.focus()
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      showRegisterResult(tourIdOf(await ApiClient.post('/api/v1/staff/tours', request, { unsafeToRetry: true })))
    } catch (error) {
      // 성공 응답의 본문만 못 읽었으면 상품은 생겼다
      if (error instanceof ApiError && error.resultUnknown && error.status !== null && error.status < 300) {
        showRegisterResult(null)
      } else if (error instanceof ApiError) {
        if (error.resultUnknown) setResultUnknown(true)
        if (!error.handled) setMessage(error.message)
      } else {
        showError(error)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">상품 기획</h1>
        <Button variant="outline" asChild>
          <Link to={pagePaths.StaffMainPage}>직원 첫 화면으로</Link>
        </Button>
      </header>

      {registered ? (
        <Card role="status">
          <CardHeader>
            <CardTitle>상품을 등록했습니다</CardTitle>
            <CardDescription>
              {registered.tourId === null ? '상품 번호를 받지 못했습니다.' : `상품 번호 ${registered.tourId}`}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            {/* 눌렀던 등록 단추가 사라지니 다음 단추로 옮긴다 */}
            <Button autoFocus onClick={showTourForm}>
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
                  aria-describedby={errorIdOf('theme', errors.theme)}
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
                <FieldError id="theme-error">{errors.theme}</FieldError>
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
                  aria-describedby={errorIdOf('departureDate', errors.departureDate)}
                />
                <FieldError id="departureDate-error">{errors.departureDate}</FieldError>
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
                    aria-describedby={errorIdOf('duration', errors.duration)}
                  />
                  <FieldError id="duration-error">{errors.duration}</FieldError>
                </Field>
                <Field data-invalid={!!errors.capacity}>
                  <FieldLabel htmlFor="capacity">정원(명)</FieldLabel>
                  <Input
                    id="capacity"
                    inputMode="numeric"
                    value={form.capacity}
                    onChange={(event) => update({ capacity: event.target.value })}
                    aria-invalid={!!errors.capacity}
                    aria-describedby={errorIdOf('capacity', errors.capacity)}
                  />
                  <FieldDescription>3명 이상, 허니문 낭만 투어는 짝수</FieldDescription>
                  <FieldError id="capacity-error">{errors.capacity}</FieldError>
                </Field>
              </div>

              <FieldSet>
                <FieldLegend>투어 등급별 1인 가격(원)</FieldLegend>
                {form.theme === '' ? (
                  <FieldDescription>테마를 고르면 가격을 입력할 투어 등급이 나옵니다.</FieldDescription>
                ) : (
                  <>
                    {grandAndPremiumOnly.includes(form.theme) && (
                      <FieldDescription>{`${themeLabel(form.theme)}는 그랜드와 프리미엄 가격만 받습니다.`}</FieldDescription>
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
                            aria-describedby={errorIdOf(`price-${level}`, errors.prices[level])}
                          />
                          <FieldError id={`price-${level}-error`}>{errors.prices[level]}</FieldError>
                        </Field>
                      ))}
                    </div>
                  </>
                )}
              </FieldSet>

              <FieldSet>
                <FieldLegend>교통 선택지</FieldLegend>
                <FieldDescription>
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
                          aria-describedby={errorIdOf(`transport-${row.id}-name`, rowErrors?.name)}
                        />
                        <FieldError id={`transport-${row.id}-name-error`}>{rowErrors?.name}</FieldError>
                      </Field>
                      <Field data-invalid={!!rowErrors?.unitPrice}>
                        <FieldLabel htmlFor={`transport-${row.id}-price`}>{`교통 ${index + 1} 1인 추가 요금(원)`}</FieldLabel>
                        <Input
                          id={`transport-${row.id}-price`}
                          inputMode="numeric"
                          value={row.unitPrice}
                          onChange={(event) => updateTransport(row.id, { unitPrice: event.target.value })}
                          aria-invalid={!!rowErrors?.unitPrice}
                          aria-describedby={errorIdOf(`transport-${row.id}-price`, rowErrors?.unitPrice)}
                        />
                        <FieldError id={`transport-${row.id}-price-error`}>{rowErrors?.unitPrice}</FieldError>
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
                <Button type="button" variant="outline" className="self-start" onClick={addTransport}>
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
              <p className="text-sm text-muted-foreground">
                이 화면에서는 상품이 등록됐는지 확인할 수 없어 등록 단추를 막았습니다. 같은 상품이 이미 등록됐을 수
                있습니다. 그래도 다시 등록하려면 화면을 새로 여세요.
              </p>
            )}
            <Button type="submit" className="self-start" disabled={submitting || resultUnknown}>
              {submitting ? '등록하는 중…' : '등록'}
            </Button>
          </div>
        </form>
      )}
    </main>
  )
}
