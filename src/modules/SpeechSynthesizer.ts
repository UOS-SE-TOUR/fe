// Chrome은 읽기가 끝났다는 신호(end)를 가끔 주지 않는다. 글자 수에 맞춘 이 시간이 지나면 끝난 것으로 본다.
// 한국어 기본 속도는 1초에 대략 6~7자라 넉넉히 잡는다(읽기 시작 신호가 오면 그때부터 다시 센다)
const SPEAK_MIN_MS = 3000
const SPEAK_MS_PER_CHAR = 200

// 읽는 빠르기(기본 1). 시연에서 듣기에 조금 느려 1.2로 둔다. 빠르게 읽으므로 위 시간은 그대로 넉넉하다
export const SPEAK_RATE = 1.2

export function speakTimeoutMs(text: string): number {
  return SPEAK_MIN_MS + text.length * SPEAK_MS_PER_CHAR
}

// 브라우저의 Web Speech API 읽어 주기(speechSynthesis, 한국어)를 감싼다(설계 3장). 한 번에 한 문장만 읽고,
// speak는 다 읽거나 멈추면 끝난다. 읽어 주기를 쓸 수 없으면 읽지 않고 바로 끝난다
export class SpeechSynthesizer {
  // 읽는 중인 문장. Chrome은 문장 객체를 놓치면(가비지 컬렉션) 끝 신호를 주지 않아, 끝날 때까지 여기 붙들어 둔다
  private current: { utterance: SpeechSynthesisUtterance; finish(): void } | null = null

  isSupported(): boolean {
    return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function'
  }

  speak(text: string): Promise<void> {
    if (!this.isSupported()) return Promise.resolve()
    // 읽던 것이 있을 때만 멈춘다(멈추자마자 읽게 한 문장을 버리는 브라우저가 있다)
    if (this.current) this.cancel()
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      let timer: ReturnType<typeof setTimeout> | undefined
      const reading = {
        utterance,
        finish: () => {
          if (this.current !== reading) return
          this.current = null
          clearTimeout(timer)
          resolve()
        },
      }
      // 시간이 지나면 읽기를 멈춘다(뒤이어 듣는 마이크에 시스템의 목소리가 들어가지 않게)
      const wait = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (this.current !== reading) return
          window.speechSynthesis.cancel()
          reading.finish()
        }, speakTimeoutMs(text))
      }
      utterance.lang = 'ko-KR'
      utterance.rate = SPEAK_RATE
      // 목소리를 불러오느라 늦게 시작한 시간은 빼고 센다
      utterance.onstart = wait
      // 오류(권한 없음·멈춤 등)여도 글은 화면에 보이니 끝난 것으로 본다
      utterance.onend = reading.finish
      utterance.onerror = reading.finish
      this.current = reading
      wait()
      try {
        window.speechSynthesis.speak(utterance)
      } catch {
        reading.finish()
      }
    })
  }

  // 읽던 것을 멈추고, 기다리던 speak를 끝낸다
  cancel() {
    const reading = this.current
    if (this.isSupported()) window.speechSynthesis.cancel()
    reading?.finish()
  }
}

// 화면이 쓰는 부분. 테스트는 이 모양의 가짜를 넣는다
export type Synthesizer = Pick<SpeechSynthesizer, 'isSupported' | 'speak' | 'cancel'>
