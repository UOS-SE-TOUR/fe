import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPEAK_RATE, SpeechSynthesizer, speakTimeoutMs } from '@/modules/SpeechSynthesizer'

// 브라우저의 SpeechSynthesisUtterance 대신 쓴다. 테스트가 끝·오류 이벤트를 직접 보낸다
class FakeUtterance {
  static instances: FakeUtterance[] = []
  lang = ''
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  text: string

  constructor(text: string) {
    this.text = text
    FakeUtterance.instances.push(this)
  }
}

let speechSynthesis: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }

function latest(): FakeUtterance {
  const utterance = FakeUtterance.instances.at(-1)
  if (!utterance) throw new Error('SpeechSynthesisUtterance를 만들지 않았다')
  return utterance
}

// speak가 끝났는지 본다(끝나지 않은 Promise는 기다리지 않는다)
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false
  void promise.then(() => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

beforeEach(() => {
  FakeUtterance.instances = []
  speechSynthesis = { speak: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('speechSynthesis', speechSynthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SpeechSynthesizer', () => {
  it('한국어로 읽고, 다 읽으면 speak가 끝난다', async () => {
    const synthesizer = new SpeechSynthesizer()
    const speaking = synthesizer.speak('안녕하세요, 고객님.')

    expect(speechSynthesis.speak).toHaveBeenCalledWith(latest())
    expect(latest().text).toBe('안녕하세요, 고객님.')
    expect(latest().lang).toBe('ko-KR')
    expect(latest().rate).toBe(SPEAK_RATE)
    expect(await settled(speaking)).toBe(false)

    latest().onend?.()
    expect(await settled(speaking)).toBe(true)
  })

  it('끝났다는 신호가 오지 않아도 글자 수에 맞춘 시간이 지나면 읽기를 멈추고 끝난다', async () => {
    vi.useFakeTimers()
    const synthesizer = new SpeechSynthesizer()
    const text = '어떤 여행을 찾으세요?'
    const speaking = synthesizer.speak(text)
    const cancelled = speechSynthesis.cancel.mock.calls.length

    vi.advanceTimersByTime(speakTimeoutMs(text) - 1)
    expect(await settled(speaking)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await settled(speaking)).toBe(true)
    expect(speechSynthesis.cancel.mock.calls.length).toBe(cancelled + 1)
  })

  it('읽기 시작 신호가 오면 그때부터 다시 센다(목소리를 불러오느라 늦게 시작한 시간은 빼고)', async () => {
    vi.useFakeTimers()
    const synthesizer = new SpeechSynthesizer()
    const text = '어떤 여행을 찾으세요?'
    const speaking = synthesizer.speak(text)

    vi.advanceTimersByTime(speakTimeoutMs(text) - 1000)
    latest().onstart?.()
    vi.advanceTimersByTime(speakTimeoutMs(text) - 1)
    expect(await settled(speaking)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await settled(speaking)).toBe(true)
  })

  it('읽다가 오류가 나도 끝난다', async () => {
    const synthesizer = new SpeechSynthesizer()
    const speaking = synthesizer.speak('안녕하세요')
    latest().onerror?.()
    expect(await settled(speaking)).toBe(true)
  })

  it('cancel하면 읽기를 멈추고 기다리던 speak가 끝나며, 늦게 온 끝 신호는 다음 읽기를 끝내지 않는다', async () => {
    const synthesizer = new SpeechSynthesizer()
    const first = synthesizer.speak('첫 문장')
    const firstUtterance = latest()

    synthesizer.cancel()
    expect(speechSynthesis.cancel).toHaveBeenCalled()
    expect(await settled(first)).toBe(true)

    const second = synthesizer.speak('둘째 문장')
    firstUtterance.onend?.()
    expect(await settled(second)).toBe(false)
    latest().onend?.()
    expect(await settled(second)).toBe(true)
  })

  it('새로 읽으면 읽던 것을 멈추고 그 speak를 끝낸다', async () => {
    const synthesizer = new SpeechSynthesizer()
    const first = synthesizer.speak('첫 문장')
    const second = synthesizer.speak('둘째 문장')

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1)
    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(false)
  })

  it('앞 문장을 다 읽었으면 멈추지 않고 바로 읽는다', async () => {
    const synthesizer = new SpeechSynthesizer()
    const first = synthesizer.speak('첫 문장')
    latest().onend?.()
    expect(await settled(first)).toBe(true)

    void synthesizer.speak('둘째 문장')
    expect(speechSynthesis.cancel).not.toHaveBeenCalled()
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('읽어 주기를 쓸 수 없으면 읽지 않고 바로 끝난다', async () => {
    vi.stubGlobal('speechSynthesis', undefined)
    const synthesizer = new SpeechSynthesizer()

    expect(synthesizer.isSupported()).toBe(false)
    expect(await settled(synthesizer.speak('안녕하세요'))).toBe(true)
    expect(FakeUtterance.instances).toEqual([])
    expect(() => synthesizer.cancel()).not.toThrow()
  })
})
