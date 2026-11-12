import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechRecognizer } from '@/modules/SpeechRecognizer'

// 브라우저의 SpeechRecognition 대신 쓴다. 테스트가 결과·오류·끝 이벤트를 직접 보낸다
class FakeRecognition {
  static instances: FakeRecognition[] = []
  static startError: Error | null = null
  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 0
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = 0
  aborted = 0

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start() {
    if (FakeRecognition.startError) throw FakeRecognition.startError
    this.started += 1
  }

  abort() {
    this.aborted += 1
  }

  // 크롬처럼 결과나 오류 뒤에 end가 온다
  result(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]] })
    this.onend?.()
  }

  error(code: string) {
    this.onerror?.({ error: code })
    this.onend?.()
  }
}

const CHROME = [
  { brand: 'Chromium', version: '142' },
  { brand: 'Google Chrome', version: '142' },
  { brand: 'Not_A Brand', version: '99' },
]

function setBrands(brands: { brand: string; version: string }[] | undefined) {
  Object.defineProperty(navigator, 'userAgentData', {
    value: brands && { brands, mobile: false, platform: 'macOS' },
    configurable: true,
  })
}

function latest(): FakeRecognition {
  const recognition = FakeRecognition.instances.at(-1)
  if (!recognition) throw new Error('SpeechRecognition을 만들지 않았다')
  return recognition
}

function listen() {
  const recognizer = new SpeechRecognizer()
  const onresult = vi.fn<(text: string) => void>()
  const onerror = vi.fn<(reason: string) => void>()
  recognizer.onresult = onresult
  recognizer.onerror = onerror
  recognizer.recognize()
  return { recognizer, onresult, onerror }
}

beforeEach(() => {
  FakeRecognition.instances = []
  FakeRecognition.startError = null
  setBrands(CHROME)
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
})

afterEach(() => {
  delete (navigator as { userAgentData?: unknown }).userAgentData
  vi.unstubAllGlobals()
})

describe('isSupported', () => {
  it('크롬이고 음성인식 기능이 있으면 쓸 수 있다', () => {
    expect(new SpeechRecognizer().isSupported()).toBe(true)
  })

  it.each([
    ['엣지', [{ brand: 'Microsoft Edge', version: '142' }, { brand: 'Chromium', version: '142' }]],
    ['웨일', [{ brand: 'Whale', version: '4' }, { brand: 'Chromium', version: '142' }]],
  ])('이름에 크롬이 든 다른 브라우저(%s)는 쓸 수 없다', (_, brands) => {
    setBrands(brands)
    expect(new SpeechRecognizer().isSupported()).toBe(false)
  })

  it('브랜드를 알려 주지 않는 브라우저(사파리·파이어폭스)는 쓸 수 없다', () => {
    setBrands(undefined)
    expect(new SpeechRecognizer().isSupported()).toBe(false)
  })

  it('크롬이어도 음성인식 기능이 없으면 쓸 수 없다', () => {
    vi.unstubAllGlobals()
    expect(new SpeechRecognizer().isSupported()).toBe(false)
  })
})

describe('recognize', () => {
  it('한국어로 한 번 듣고, 알아들은 글자를 onresult로 한 번만 알린다', () => {
    const { onresult, onerror } = listen()
    const recognition = latest()
    expect(recognition).toMatchObject({ lang: 'ko-KR', continuous: false, interimResults: false, started: 1 })

    recognition.result('12월 20일 골프 투어 그랜드 2명')
    expect(onresult).toHaveBeenCalledTimes(1)
    expect(onresult).toHaveBeenCalledWith('12월 20일 골프 투어 그랜드 2명')
    expect(onerror).not.toHaveBeenCalled()
  })

  it('접두어 없는 SpeechRecognition이 있으면 그것을 쓴다', () => {
    class Unprefixed extends FakeRecognition {}
    vi.stubGlobal('SpeechRecognition', Unprefixed)
    listen()
    expect(latest()).toBeInstanceOf(Unprefixed)
  })

  it.each([
    ['not-allowed', 'not-allowed'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'other'],
    ['network', 'other'],
    ['service-not-allowed', 'other'],
  ])('인식 오류 %s는 %s로 한 번만 알린다', (code, reason) => {
    const { onresult, onerror } = listen()
    latest().error(code)
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(onerror).toHaveBeenCalledWith(reason)
    expect(onresult).not.toHaveBeenCalled()
  })

  it('알아들은 글자가 비었으면 말소리를 듣지 못한 것으로 알린다', () => {
    const { onresult, onerror } = listen()
    latest().result('  ')
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(onerror).toHaveBeenCalledWith('no-speech')
    expect(onresult).not.toHaveBeenCalled()
  })

  it('결과도 오류도 없이 끝나면 말소리를 듣지 못한 것으로 알린다', () => {
    const { onerror } = listen()
    latest().onend?.()
    expect(onerror).toHaveBeenCalledWith('no-speech')
  })

  it('듣기를 시작하지 못하면 그 밖의 인식 오류로 알린다', () => {
    FakeRecognition.startError = new DOMException('already started', 'InvalidStateError')
    const { onerror } = listen()
    expect(onerror).toHaveBeenCalledWith('other')
  })

  it('음성인식 기능이 없으면 그 밖의 인식 오류로 알린다', () => {
    vi.unstubAllGlobals()
    const { onerror } = listen()
    expect(onerror).toHaveBeenCalledWith('other')
  })

  it('그만두면 듣기를 끊고, 그 뒤에 온 이벤트는 알리지 않는다', () => {
    const { recognizer, onresult, onerror } = listen()
    const recognition = latest()
    recognizer.abort()
    expect(recognition.aborted).toBe(1)

    recognition.error('aborted')
    recognition.result('늦게 온 글자')
    expect(onresult).not.toHaveBeenCalled()
    expect(onerror).not.toHaveBeenCalled()
  })

  it('다시 들으면 앞서 듣던 것을 끊고 그 이벤트는 버린다', () => {
    const { recognizer, onresult } = listen()
    const first = latest()
    recognizer.recognize()
    const second = latest()
    expect(first.aborted).toBe(1)

    first.result('앞선 글자')
    second.result('새 글자')
    expect(onresult).toHaveBeenCalledTimes(1)
    expect(onresult).toHaveBeenCalledWith('새 글자')
  })
})
