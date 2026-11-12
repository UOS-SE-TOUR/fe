import { describe, expect, it } from 'vitest'
import { editPhoneNumber, formatPhoneNumber } from '@/lib/phoneNumber'

function format(text: string) {
  return formatPhoneNumber(text)?.value
}

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
    expect(format(text)).toBe(expected)
  })

  it('010은 넷째 숫자부터 3-4-4로 끊는다', () => {
    expect(format('0101')).toBe('010-1')
    expect(format('01012345')).toBe('010-1234-5')
  })

  it('011·016~019는 10자리까지 3-3-4, 11자리면 3-4-4로 끊는다', () => {
    expect(format('011123')).toBe('011-123')
    expect(format('0111234')).toBe('011-123-4')
    for (const prefix of ['016', '017', '018', '019']) {
      expect(format(`${prefix}1234567`)).toBe(`${prefix}-123-4567`)
      expect(format(`${prefix}12345678`)).toBe(`${prefix}-1234-5678`)
    }
  })

  it('01로 시작하는데 11자리를 넘으면 꼴을 만들지 않는다', () => {
    expect(formatPhoneNumber('010123456789')).toBeNull()
    expect(formatPhoneNumber('+82 10-1234-56789')).toBeNull()
    expect(formatPhoneNumber('0151234567890')).toBeNull()
    expect(format('01512345678')).toBe('01512345678')
  })

  it('하이픈·공백 같은 다른 글자는 지우고 다시 붙인다', () => {
    expect(format('010 1234 5678')).toBe('010-1234-5678')
    expect(format('010-12-345678')).toBe('010-1234-5678')
    expect(format('010.1234.5678')).toBe('010-1234-5678')
  })

  it('+82로 시작하면 82를 떼고, 남은 번호가 0으로 시작하지 않을 때만 0을 붙인다', () => {
    expect(format('+82 010-1234-5678')).toBe('010-1234-5678')
    expect(format('+821012345678')).toBe('010-1234-5678')
    expect(format(' +82 10 1234 5678')).toBe('010-1234-5678')
    expect(format('+82 11-123-4567')).toBe('011-123-4567')
  })

  it('+82가 아니면 +는 지우고 숫자만 남긴다', () => {
    expect(format('+')).toBe('')
    expect(format('+1 555-123-4567')).toBe('15551234567')
    expect(format('821012345678')).toBe('821012345678')
  })

  it('01로 시작하지 않는 번호는 하이픈을 붙이지 않고 자릿수도 막지 않는다', () => {
    expect(format('0212345678901')).toBe('0212345678901')
    expect(format('0121234567')).toBe('0121234567')
  })

  it('커서를 같은 숫자 바로 뒤에 둔다', () => {
    // 010-12|34-567에 9를 넣었다
    expect(formatPhoneNumber('010-12934-567', 7)).toEqual({ value: '010-1293-4567', caret: 7 })
    // 010-1234-5678의 가운데 2를 지웠다(010-1|34-5678)
    expect(formatPhoneNumber('010-134-5678', 5)).toEqual({ value: '010-1345-678', caret: 5 })
    // 넷째 숫자를 치면 커서가 새로 붙은 하이픈 너머로 간다
    expect(formatPhoneNumber('0101', 4)).toEqual({ value: '010-1', caret: 5 })
  })

  it('+82 번호를 붙여 넣으면 커서가 끝에 온다', () => {
    expect(formatPhoneNumber('+82 10-1234-5678', 16)).toEqual({ value: '010-1234-5678', caret: 13 })
    expect(formatPhoneNumber('+82 010-1234-5678', 17)).toEqual({ value: '010-1234-5678', caret: 13 })
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

  it('하이픈 바로 뒤의 숫자를 지우면 커서가 하이픈 뒤에 남는다', () => {
    // 010-1|234-5678에서 Backspace
    expect(editPhoneNumber(full, '010-234-5678', 4, 'deleteContentBackward')).toEqual({
      value: '010-2345-678',
      caret: 4,
    })
  })

  it('숫자를 넣거나 가운데 숫자를 지우면 꼴만 맞춘다', () => {
    expect(editPhoneNumber('010', '0101', 4, 'insertText')).toEqual({ value: '010-1', caret: 5 })
    expect(editPhoneNumber(full, '010-134-5678', 5, 'deleteContentBackward')).toEqual({
      value: '010-1345-678',
      caret: 5,
    })
  })

  it('하이픈 앞에서 공백이나 하이픈을 쳐도 커서가 하이픈을 넘어가지 않는다', () => {
    // 010-1234|-5678
    expect(editPhoneNumber(full, '010-1234 -5678', 9, 'insertText')).toEqual({ value: full, caret: 8 })
    expect(editPhoneNumber(full, '010-1234--5678', 9, 'insertText')).toEqual({ value: full, caret: 8 })
  })

  it('지우기 키가 아닌 입력으로 하이픈만 빠지면 하이픈을 다시 붙인다', () => {
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteByCut')).toEqual({ value: full, caret: 8 })
    expect(editPhoneNumber(full, '010-12345678', 8)).toEqual({ value: full, caret: 8 })
  })

  it('하이픈 하나만 골라 지우면 숫자는 그대로 두고 하이픈을 다시 붙인다', () => {
    const hyphen = { start: 8, end: 9 }
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteContentBackward', hyphen)).toEqual({ value: full, caret: 8 })
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteContentForward', hyphen)).toEqual({ value: full, caret: 8 })
  })

  it('커서만 있던 자리에서 지웠다고 적혀 있으면 하이픈 너머의 숫자를 지운다', () => {
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteContentBackward', { start: 9, end: 9 })).toEqual({
      value: '010-1235-678',
      caret: 7,
    })
  })

  it('단어 지우기로 하이픈만 지워져도 하이픈 너머의 숫자를 지운다', () => {
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteWordBackward')).toEqual({ value: '010-1235-678', caret: 7 })
    expect(editPhoneNumber(full, '010-12345678', 8, 'deleteWordForward')).toEqual({ value: '010-1234-678', caret: 8 })
  })

  it('지우다가 01로 시작하는 11자리 넘는 번호가 되면 숫자만 보이고, 더 지워 11자리가 되면 다시 끊는다', () => {
    // 0|210123456789에서 2를 지웠다(01로 시작하지 않으면 자릿수를 막지 않는다)
    expect(editPhoneNumber('0210123456789', '010123456789', 1, 'deleteContentForward', { start: 1, end: 1 })).toEqual({
      value: '010123456789',
      caret: 1,
    })
    expect(editPhoneNumber('010123456789', '01012345678', 11, 'deleteContentBackward', { start: 12, end: 12 })).toEqual({
      value: '010-1234-5678',
      caret: 13,
    })
  })

  it('바꿔서 01로 시작하는 11자리 넘는 번호가 되면 받지 않는다', () => {
    // 0[2]12345678901의 2를 1로 바꿨다
    expect(editPhoneNumber('0212345678901', '0112345678901', 2, 'insertText', { start: 1, end: 2 })).toEqual({
      value: '0212345678901',
      caret: 1,
      selectionEnd: 2,
      rejected: true,
    })
  })

  it('11자리를 넘겨 치면 칸이 늘지 않고 커서도 그 자리에 남는다', () => {
    // 끝에 더 쳤다
    expect(editPhoneNumber(full, '010-1234-56789', 14, 'insertText', { start: 13, end: 13 })).toEqual({
      value: full,
      caret: 13,
      selectionEnd: 13,
      rejected: true,
    })
    // 010-12|34-5678에 9를 넣었다. 입력 전 범위가 적혀 있지 않으면 넣은 글자 수로 되짚는다
    expect(editPhoneNumber(full, '010-12934-5678', 7, 'insertText')).toEqual({
      value: full,
      caret: 6,
      selectionEnd: 6,
      rejected: true,
    })
  })

  it('쓰던 번호에 붙여 넣어 11자리를 넘으면 붙여 넣기를 받지 않는다', () => {
    // 010-12|에 01099998888을 붙여 넣었다 — 잘라 남기면 010-1201-0999가 된다
    expect(editPhoneNumber('010-12', '010-1201099998888', 17, 'insertFromPaste', { start: 6, end: 6 })).toEqual({
      value: '010-12',
      caret: 6,
      selectionEnd: 6,
      rejected: true,
    })
    // 010-1|에 +82 10-9999-8888을 붙여 넣었다
    expect(editPhoneNumber('010-1', '010-1+82 10-9999-8888', 21, 'insertFromPaste', { start: 5, end: 5 })).toEqual({
      value: '010-1',
      caret: 5,
      selectionEnd: 5,
      rejected: true,
    })
  })

  it('고른 범위에 붙여 넣어 받지 않으면 고른 범위를 되살린다', () => {
    // 010-1234[-5678]에 999999를 붙여 넣었다
    expect(editPhoneNumber(full, '010-1234999999', 14, 'insertFromPaste', { start: 8, end: 13 })).toEqual({
      value: full,
      caret: 8,
      selectionEnd: 13,
      rejected: true,
    })
  })
})
