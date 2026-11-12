// 회원가입 연락처 칸의 꼴. 끊는 규칙은 서버(be MemberService)가 받는 휴대폰 번호 꼴에 맞춘다
// — 010은 11자리, 011·016~019는 10·11자리

const MOBILE_MAX_DIGITS = 11
const HYPHENATED_PREFIX = /^01[016789]/
// 크롬 자동 완성은 +82 10-1234-5678처럼 국가 번호로 넣는다. 숫자만 남기면 8210…이 되어 서버가 거절한다
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

// 칸에 들어온 글자와 커서 자리를 받아, 꼴을 맞춘 값과 커서 자리(같은 숫자 바로 뒤)를 낸다
export function formatPhoneNumberInput(text: string, caret: number): PhoneNumberInput {
  let digits = digitsOf(text)
  let caretDigits = digitsOf(text.slice(0, caret)).length
  if (COUNTRY_CODE.test(text)) {
    const national = digits.slice(2)
    const leadingZero = national.startsWith('0') ? '' : '0'
    digits = leadingZero + national
    caretDigits = caretDigits <= 2 ? 0 : caretDigits - 2 + leadingZero.length
  }
  if (digits.startsWith('01') && digits.length > MOBILE_MAX_DIGITS) {
    // 넘친 숫자는 방금 넣은 것(커서 바로 앞)부터 버린다. 칸이 꽉 찼으면 가운데에 더 쳐도 그대로다
    const cut = Math.min(digits.length - MOBILE_MAX_DIGITS, caretDigits)
    digits = (digits.slice(0, caretDigits - cut) + digits.slice(caretDigits)).slice(0, MOBILE_MAX_DIGITS)
    caretDigits = Math.min(caretDigits - cut, digits.length)
  }
  const value = hyphenate(digits)
  let position = positionAfterDigits(value, caretDigits)
  // 하이픈 바로 뒤의 숫자를 지웠으면 커서도 하이픈 뒤에 남긴다
  if (caret > 0 && !/[0-9]/.test(text[caret - 1]) && value[position] === '-') position += 1
  return { value, caret: position }
}

export function formatPhoneNumber(text: string) {
  return formatPhoneNumberInput(text, text.length).value
}

// 연락처 칸의 입력 하나(input 이벤트)를 반영한다. previous는 칸에 보이던 값, text·caret은 입력 뒤의 글자와 커서 자리다.
// 하이픈만 지워졌으면(하이픈 뒤 Backspace·하이픈 앞 Delete) 그 너머의 숫자를 지운다 — 하이픈이 다시 붙어 아무 일도 안 일어난 것처럼 보이지 않게
export function editPhoneNumber(previous: string, text: string, caret: number, inputType?: string): PhoneNumberInput {
  const step = inputType === 'deleteContentBackward' ? -1 : inputType === 'deleteContentForward' ? 0 : null
  const digits = digitsOf(text)
  if (step !== null && text.length === previous.length - 1 && digits === digitsOf(previous)) {
    const index = digitsOf(text.slice(0, caret)).length + step
    if (index >= 0 && index < digits.length) {
      return formatPhoneNumberInput(digits.slice(0, index) + digits.slice(index + 1), index)
    }
  }
  return formatPhoneNumberInput(text, caret)
}
