// 듣지 못한 까닭. not-allowed는 마이크 권한 거부, no-speech는 말소리 없이 끝남, other는 그 밖의 인식 오류다
export type RecognitionFailure = 'not-allowed' | 'no-speech' | 'other'

// TypeScript의 DOM 타입에는 SpeechRecognition이 없어 여기서 쓰는 만큼만 적는다
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition

interface WithSpeechRecognition {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

// navigator.userAgentData(User-Agent Client Hints)도 DOM 타입에 없다. 크로미움 계열 브라우저만 HTTPS·localhost에서 준다
interface WithUserAgentData {
  userAgentData?: { brands: { brand: string }[] }
}

function recognitionClass(): RecognitionConstructor | null {
  const scope = window as Window & WithSpeechRecognition
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

// 설계대로 크롬에서만 음성을 켠다. 이름에 Chrome이 든 엣지·웨일 등은 브랜드에 "Google Chrome"이 없다
function isChrome(): boolean {
  const brands = (navigator as Navigator & WithUserAgentData).userAgentData?.brands ?? []
  return brands.some((item) => item.brand === 'Google Chrome')
}

function failureOf(error: SpeechRecognitionErrorCode): RecognitionFailure {
  if (error === 'not-allowed') return 'not-allowed'
  if (error === 'no-speech') return 'no-speech'
  return 'other'
}

// 브라우저의 Web Speech API(한국어)를 감싼다(설계 3장). 한 번 말할 때마다 recognize()를 부르고,
// 알아들은 글자는 onresult로, 듣지 못한 까닭은 onerror로 한 번만 받는다
export class SpeechRecognizer {
  onresult: (text: string) => void = () => {}
  onerror: (reason: RecognitionFailure) => void = () => {}
  private current: Recognition | null = null

  isSupported(): boolean {
    return isChrome() && recognitionClass() !== null
  }

  recognize() {
    this.abort()
    const Constructor = recognitionClass()
    if (!Constructor) {
      this.onerror('other')
      return
    }
    const recognition = new Constructor()
    recognition.lang = 'ko-KR'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    // 결과 뒤에도 end가, 오류 뒤에도 end가 온다. 그만뒀거나(abort) 다시 듣기 시작한 뒤에 온 이벤트는 버린다
    const finish = (report: () => void) => {
      if (this.current !== recognition) return
      this.current = null
      report()
    }
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? ''
      finish(() => this.onresult(text))
    }
    recognition.onerror = (event) => finish(() => this.onerror(failureOf(event.error)))
    // 결과도 오류도 없이 끝나면 말소리를 듣지 못한 것으로 본다
    recognition.onend = () => finish(() => this.onerror('no-speech'))
    this.current = recognition
    try {
      recognition.start()
    } catch {
      finish(() => this.onerror('other'))
    }
  }

  // 듣던 것을 그만둔다. 그 뒤로는 결과도 실패도 알리지 않는다
  abort() {
    const recognition = this.current
    this.current = null
    recognition?.abort()
  }
}

// 화면이 쓰는 부분. 테스트는 이 모양의 가짜를 넣는다
export type Recognizer = Pick<SpeechRecognizer, 'isSupported' | 'recognize' | 'abort' | 'onresult' | 'onerror'>
