// 회원가입 연락처 칸의 꼴. 서버(be MemberService)가 받는 휴대폰 번호 꼴(010은 11자리, 011·016~019는 10·11자리)대로 끊는다

const MOBILE_MAX_DIGITS = 11
const HYPHENATED_PREFIX = /^01[016789]/
// 크롬 자동 완성은 +82 10-1234-5678처럼 국가 번호로 넣는다
const COUNTRY_CODE = /^\s*\+82/

export interface PhoneNumberInput {
  value: string
  caret: number
  // 받지 않은 입력이면 rejected와 입력 전에 고른 범위의 끝이 붙는다
  selectionEnd?: number
  rejected?: true
}

export interface PhoneNumberSelection {
  start: number
  end: number
}

function digitsOf(text: string) {
  return text.replace(/[^0-9]/g, '')
}

function hyphenate(digits: string) {
  if (!HYPHENATED_PREFIX.test(digits) || digits.length <= 3) return digits
  const middleLength = digits.startsWith('010') || digits.length === MOBILE_MAX_DIGITS ? 4 : 3
  return [digits.slice(0, 3), digits.slice(3, 3 + middleLength), digits.slice(3 + middleLength)]
    .filter((part) => part !== '')
    .join('-')
}

function positionAfterDigits(value: string, count: number) {
  if (count <= 0) return 0
  let seen = 0
  for (let index = 0; index < value.length; index += 1) {
    if (/[0-9]/.test(value[index]) && ++seen === count) return index + 1
  }
  return value.length
}

// 01로 시작하는데 11자리를 넘으면 null
export function formatPhoneNumber(text: string, caret = text.length): PhoneNumberInput | null {
  let digits = digitsOf(text)
  let caretDigits = digitsOf(text.slice(0, caret)).length
  if (COUNTRY_CODE.test(text)) {
    const national = digits.slice(2)
    const leadingZero = national.startsWith('0') ? '' : '0'
    digits = leadingZero + national
    caretDigits = caretDigits <= 2 ? 0 : caretDigits - 2 + leadingZero.length
  }
  if (digits.startsWith('01') && digits.length > MOBILE_MAX_DIGITS) return null
  const value = hyphenate(digits)
  return { value, caret: positionAfterDigits(value, caretDigits) }
}

// 하이픈만 지운 지우기 키가 지울 숫자의 자리(커서 앞 숫자 수에 더할 값)
const HYPHEN_DELETE_STEPS: Partial<Record<string, number>> = {
  deleteContentBackward: -1,
  deleteWordBackward: -1,
  deleteContentForward: 0,
  deleteWordForward: 0,
}

export function editPhoneNumber(
  previous: string,
  text: string,
  caret: number,
  inputType?: string,
  selectionBefore?: PhoneNumberSelection,
): PhoneNumberInput {
  const digits = digitsOf(text)
  const caretDigits = digitsOf(text.slice(0, caret)).length
  const deleting = inputType?.startsWith('delete') === true
  // 커서에서 하이픈만 지웠으면 그 너머의 숫자를 지운다(그대로 두면 하이픈이 다시 붙어 아무 일도 안 일어난다)
  const step = inputType === undefined ? undefined : HYPHEN_DELETE_STEPS[inputType]
  const collapsed = !selectionBefore || selectionBefore.start === selectionBefore.end
  if (step !== undefined && collapsed && text.length === previous.length - 1 && digits === digitsOf(previous)) {
    const index = caretDigits + step
    const next = formatPhoneNumber(digits.slice(0, index) + digits.slice(index + 1), index)
    if (next) return next
  }
  const next = formatPhoneNumber(text, caret)
  if (!next) {
    // 지우기는 늘 받는다(11자리 넘는 01 번호는 숫자만 보인다)
    if (deleting) return { value: digits, caret: caretDigits }
    // 넣거나 바꿔서 11자리를 넘기면 받지 않는다(잘라 남기면 붙여 넣은 번호가 섞여 엉뚱한 번호가 된다)
    const caretBefore = caret - (text.length - previous.length)
    const { start, end } = selectionBefore ?? { start: caretBefore, end: caretBefore }
    const clamp = (position: number) => Math.max(0, Math.min(previous.length, position))
    return { value: previous, caret: clamp(start), selectionEnd: clamp(end), rejected: true }
  }
  // 하이픈 바로 뒤의 숫자를 지웠으면 커서도 하이픈 뒤에 남긴다
  if (deleting && caret > 0 && !/[0-9]/.test(text[caret - 1]) && next.value[next.caret] === '-') {
    return { value: next.value, caret: next.caret + 1 }
  }
  return next
}
