import { describe, expect, it } from 'vitest'
import { editPhoneNumber, formatPhoneNumber, formatPhoneNumberInput } from '@/lib/phoneNumber'

describe('formatPhoneNumber', () => {
  it.each([
    ['01012345678', '010-1234-5678'],
    ['0101234', '010-1234'],
    ['010', '010'],
    ['0111234567', '011-123-4567'],
    ['01112345678', '011-1234-5678'],
    ['+82 10-1234-5678', '010-1234-5678'],
    ['02-123-4567', '021234567'],
  ])('이슈 표대로 %s를 %s로 보인다', (text, expected) => {
    expect(formatPhoneNumber(text)).toBe(expected)
  })

  it('010은 넷째 숫자부터 3-4-4로 끊는다', () => {
    expect(formatPhoneNumber('0101')).toBe('010-1')
    expect(formatPhoneNumber('01012345')).toBe('010-1234-5')
  })

  it('011·016~019는 10자리까지 3-3-4, 11자리면 3-4-4로 끊는다', () => {
    expect(formatPhoneNumber('011123')).toBe('011-123')
    expect(formatPhoneNumber('0111234')).toBe('011-123-4')
    for (const prefix of ['016', '017', '018', '019']) {
      expect(formatPhoneNumber(`${prefix}1234567`)).toBe(`${prefix}-123-4567`)
      expect(formatPhoneNumber(`${prefix}12345678`)).toBe(`${prefix}-1234-5678`)
    }
  })

  it('01로 시작하면 11자리까지만 받는다', () => {
    expect(formatPhoneNumber('010123456789')).toBe('010-1234-5678')
    expect(formatPhoneNumber('0111234567899')).toBe('011-1234-5678')
    expect(formatPhoneNumber('0151234567890')).toBe('01512345678')
  })

  it('하이픈·공백 같은 다른 글자는 지우고 다시 붙인다', () => {
    expect(formatPhoneNumber('010 1234 5678')).toBe('010-1234-5678')
    expect(formatPhoneNumber('010-12-345678')).toBe('010-1234-5678')
    expect(formatPhoneNumber('010.1234.5678')).toBe('010-1234-5678')
  })

  it('+82로 시작하면 82를 떼고, 남은 번호가 0으로 시작하지 않을 때만 0을 붙인다', () => {
    expect(formatPhoneNumber('+82 010-1234-5678')).toBe('010-1234-5678')
    expect(formatPhoneNumber('+821012345678')).toBe('010-1234-5678')
    expect(formatPhoneNumber(' +82 10 1234 5678')).toBe('010-1234-5678')
    expect(formatPhoneNumber('+82 11-123-4567')).toBe('011-123-4567')
  })

  it('+82가 아니면 +는 지우고 숫자만 남긴다', () => {
    expect(formatPhoneNumber('+')).toBe('')
    expect(formatPhoneNumber('+1 555-123-4567')).toBe('15551234567')
    expect(formatPhoneNumber('821012345678')).toBe('821012345678')
  })

  it('01로 시작하지 않는 번호는 하이픈을 붙이지 않고 자릿수도 막지 않는다', () => {
    expect(formatPhoneNumber('0212345678901')).toBe('0212345678901')
    expect(formatPhoneNumber('0121234567')).toBe('0121234567')
  })
})

describe('formatPhoneNumberInput', () => {
  it('커서를 같은 숫자 바로 뒤에 둔다', () => {
    // 010-12|34-567에 9를 넣었다
    expect(formatPhoneNumberInput('010-12934-567', 7)).toEqual({ value: '010-1293-4567', caret: 7 })
    // 010-1234-5678의 가운데 2를 지웠다(010-1|34-5678)
    expect(formatPhoneNumberInput('010-134-5678', 5)).toEqual({ value: '010-1345-678', caret: 5 })
  })

  it('넷째 숫자를 치면 커서가 붙은 하이픈 뒤의 숫자 뒤로 간다', () => {
    expect(formatPhoneNumberInput('0101', 4)).toEqual({ value: '010-1', caret: 5 })
  })

  it('하이픈 바로 뒤의 숫자를 지우면 커서가 하이픈 뒤에 남는다', () => {
    // 010-1|234-5678에서 Backspace
    expect(formatPhoneNumberInput('010-234-5678', 4)).toEqual({ value: '010-2345-678', caret: 4 })
  })

  it('꽉 찬 번호 가운데에 더 치면 값과 커서가 그대로다', () => {
    // 010-12|34-5678에 9를 넣었다
    expect(formatPhoneNumberInput('010-12934-5678', 7)).toEqual({ value: '010-1234-5678', caret: 6 })
  })

  it('넘친 붙여 넣기는 들어간 만큼만 남긴다', () => {
    // 010-1234-56|에 789를 붙여 넣었다
    expect(formatPhoneNumberInput('010-1234-56789', 14)).toEqual({ value: '010-1234-5678', caret: 13 })
  })

  it('+82 번호를 붙여 넣으면 커서가 끝에 온다', () => {
    expect(formatPhoneNumberInput('+82 10-1234-5678', 16)).toEqual({ value: '010-1234-5678', caret: 13 })
    expect(formatPhoneNumberInput('+82 010-1234-5678', 17)).toEqual({ value: '010-1234-5678', caret: 13 })
  })
})

describe('editPhoneNumber', () => {
  const full = '010-1234-5678'

  it('하이픈 바로 뒤에서 Backspace를 누르면 하이픈 앞의 숫자를 지운다', () => {
    // 010-1234-|5678 → 둘째 하이픈이 지워진 채 들어온다
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteContentBackward')).toEqual({
      value: '010-1235-678',
      caret: 7,
    })
    // 010-|1234-5678
    expect(editPhoneNumber(full, '0101234-5678', 3, 'deleteContentBackward')).toEqual({
      value: '011-234-5678',
      caret: 2,
    })
  })

  it('하이픈 바로 앞에서 Delete를 누르면 하이픈 뒤의 숫자를 지운다', () => {
    // 010-1234|-5678
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteContentForward')).toEqual({
      value: '010-1234-678',
      caret: 8,
    })
  })

  it('숫자를 지우거나 넣는 입력은 꼴만 맞춘다', () => {
    expect(editPhoneNumber(full, '010-134-5678', 5, 'deleteContentBackward')).toEqual({
      value: '010-1345-678',
      caret: 5,
    })
    expect(editPhoneNumber('010', '0101', 4, 'insertText')).toEqual({ value: '010-1', caret: 5 })
  })

  it('지우기 키가 아닌 입력으로 하이픈만 빠지면 하이픈을 다시 붙인다', () => {
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteByCut')).toEqual({ value: full, caret: 8 })
    expect(editPhoneNumber(full, '010-12345678', 8)).toEqual({ value: full, caret: 8 })
  })
})
