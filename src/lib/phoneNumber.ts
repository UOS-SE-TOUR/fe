// 회원가입 연락처 칸의 꼴. 서버(be MemberService)가 받는 휴대폰 번호 꼴(010은 11자리, 011·016~019는 10·11자리)대로 끊는다

const MOBILE_MAX_DIGITS = 11
const HYPHENATED_PREFIX = /^01[016789]/
// 크롬 자동 완성은 +82 10-1234-5678처럼 국가 번호로 넣는다
const COUNTRY_CODE = /^\s*\+82/

export interface PhoneNumberInput {
  value: string
  caret: number
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

// 커서는 같은 숫자 바로 뒤에 둔다. 01로 시작하는데 11자리를 넘으면 null
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

// 연락처 칸의 입력 하나를 반영한다. previous는 칸에 보이던 값, text·caret은 입력 뒤의 글자와 커서 자리,
// selectionWasCollapsed는 입력 전에 고른 글자 없이 커서만 있었는지다
export function editPhoneNumber(
  previous: string,
  text: string,
  caret: number,
  inputType?: string,
  selectionWasCollapsed = true,
): PhoneNumberInput {
  const digits = digitsOf(text)
  const caretDigits = digitsOf(text.slice(0, caret)).length
  // 커서에서 지우기 키로 하이픈만 지웠으면 그 너머의 숫자를 지운다 — 하이픈이 다시 붙어 아무 일도 안 일어난 것처럼 보이지 않게
  const step = inputType === 'deleteContentBackward' ? -1 : inputType === 'deleteContentForward' ? 0 : null
  if (step !== null && selectionWasCollapsed && text.length === previous.length - 1 && digits === digitsOf(previous)) {
    const index = caretDigits + step
    if (index >= 0 && index < digits.length) {
      const shortened = digits.slice(0, index) + digits.slice(index + 1)
      return formatPhoneNumber(shortened, index) ?? { value: shortened, caret: index }
    }
  }
  const next = formatPhoneNumber(text, caret)
  if (!next) {
    // 숫자를 더해 11자리를 넘기면(꽉 찬 번호에 더 치기, 쓰던 번호에 붙여 넣기) 받지 않는다 — 잘라 남기면 엉뚱한 번호가 된다
    if (digits.length > digitsOf(previous).length) {
      return { value: previous, caret: Math.max(0, Math.min(previous.length, caret - (text.length - previous.length))) }
    }
    return { value: digits, caret: caretDigits }
  }
  // 하이픈 바로 뒤의 숫자를 지웠으면 커서도 하이픈 뒤에 남긴다
  if (inputType?.startsWith('delete') && caret > 0 && !/[0-9]/.test(text[caret - 1]) && next.value[next.caret] === '-') {
    return { value: next.value, caret: next.caret + 1 }
  }
  return next
}
