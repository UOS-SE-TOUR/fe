import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Mic } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tourStatusLabel, type TourStatus } from '@/lib/labels'
import {
  EMPTY_VOICE_DRAFT,
  isVoiceChatResponse,
  type VoiceChatRequest,
  type VoiceChatResponse,
  type VoiceDraft,
  type VoiceMessage,
} from '@/lib/tours'
import { cn } from '@/lib/utils'
import { ApiClient, hasStatus, showError } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { SpeechRecognizer, type RecognitionFailure, type Recognizer } from '@/modules/SpeechRecognizer'
import { SpeechSynthesizer, type Synthesizer } from '@/modules/SpeechSynthesizer'
import type { VoiceInputProps, VoiceSelection } from '@/pages/TourSelectPage'

const UNSUPPORTED_MESSAGE = '이 브라우저에서는 음성 입력을 쓸 수 없습니다. 크롬에서 열거나, 화면에서 직접 골라 주세요.'
const MIC_DENIED_MESSAGE = '마이크 권한이 없어 음성 입력을 쓸 수 없습니다. 화면에서 직접 골라 주세요.'
// 그 밖의 인식 오류(네트워크·마이크 없음·정책 차단 등). 잠깐의 실패인지 가릴 수 없어 대화는 두고 다시 말할 수 있게 한다
const RECOGNITION_FAILED_MESSAGE = '음성을 인식하지 못했습니다. 화면에서 직접 골라 주세요.'
const VOICE_UNAVAILABLE_MESSAGE = '지금은 음성으로 고를 수 없습니다. 화면에서 직접 골라 주세요.'
const NO_SPEECH_MESSAGE = '말소리를 듣지 못했습니다. 다시 말해 주세요.'
const DISABLED_MESSAGE = '신청 결과를 확인하기 전에는 음성으로 고를 수 없습니다.'
const INTRO_MESSAGE = '묻는 말에 답하면 여행을 고르고 신청까지 해 드립니다.'
const STOPPED_MESSAGE = '음성 대화를 끝냈습니다. 화면에서 직접 고르거나 다시 시작해 주세요.'
// 확인받지 않은 내용으로 APPLY가 왔을 때, 신청하지 않고 칸을 채운 뒤 읽는 말(가격이 나왔을 때만 읽는다)
const CONFIRM_AGAIN_MESSAGE =
  '고른 내용으로 가격을 계산했습니다. 화면의 가격을 확인하시고, 이대로 신청할지 말씀해 주세요.'

function greetingFor(name: string | null): string {
  return name ? `안녕하세요, ${name} 고객님. 어떤 여행을 찾으세요?` : '안녕하세요, 고객님. 어떤 여행을 찾으세요?'
}

function appliedMessage(status: TourStatus): string {
  return `신청했습니다. 지금 상품 상태는 ‘${tourStatusLabel(status)}’입니다.`
}

// idle은 대화가 없을 때(시작 전이거나 끝남), speaking은 시스템의 말을 읽는 중, listening은 고객의 말을 듣는 중,
// waiting은 서버의 답을 기다리는 중, working은 상품 선택 화면이 칸을 채우거나 신청하는 중이다.
// paused는 인식에 실패해 "다시 말하기"를 기다리는 중으로, 대화는 그대로 있다
type Step = 'idle' | 'speaking' | 'listening' | 'waiting' | 'working' | 'paused'

const STEP_MESSAGES: Record<'speaking' | 'listening' | 'waiting' | 'working', string> = {
  speaking: '말하는 중입니다.',
  listening: '듣고 있습니다. 말씀해 주세요.',
  waiting: '답을 기다리는 중입니다.',
  working: '화면에 반영하는 중입니다.',
}

// 상품·투어 등급·인원이 다 정해졌으면 상품 선택 화면에 넘길 값을 돌려준다
function selectionOf(draft: VoiceDraft): VoiceSelection | null {
  const { theme, tourId, level, headcount, optionIds } = draft
  if (theme === null || tourId === null || level === null || headcount === null) return null
  return { theme, tourId, level, headcount, optionIds }
}

function optionKey(selection: VoiceSelection): string {
  return [...selection.optionIds].sort((a, b) => a - b).join(',')
}

function sameSelection(previous: VoiceSelection | null, next: VoiceSelection): boolean {
  return (
    previous !== null &&
    previous.theme === next.theme &&
    previous.tourId === next.tourId &&
    previous.level === next.level &&
    previous.headcount === next.headcount &&
    optionKey(previous) === optionKey(next)
  )
}

// 화면에 보이는 고른 내용(테마·상품·투어 등급·인원)이 같다. 옵션은 가격과 함께 보이므로 덜 정해진 동안에는 보지 않는다
function sameChoice(previous: VoiceDraft, next: VoiceDraft): boolean {
  return (
    previous.theme === next.theme &&
    previous.tourId === next.tourId &&
    previous.level === next.level &&
    previous.headcount === next.headcount
  )
}

interface VoiceInputPanelProps extends VoiceInputProps {
  // 테스트는 가짜를 넣는다(테스트 환경에는 브라우저 음성인식·읽어 주기가 없다)
  createRecognizer?: () => Recognizer
  createSynthesizer?: () => Synthesizer
}

function newRecognizer(): Recognizer {
  return new SpeechRecognizer()
}

function newSynthesizer(): Synthesizer {
  return new SpeechSynthesizer()
}

// 시스템과 고객이 말을 주고받아 상품을 고르고 신청까지 한다(설계 3.1 VoiceInputPanel·5.5).
// disabled면 상품 선택 화면이 신청 결과를 확인하기 전이다. 대화를 끝내고 시작을 막는다
export function VoiceInputPanel({
  previewSelection,
  applySelection,
  applyTour,
  screenEdits,
  disabled,
  createRecognizer = newRecognizer,
  createSynthesizer = newSynthesizer,
}: VoiceInputPanelProps) {
  const [supported] = useState(() => createRecognizer().isSupported())
  const [synthesizer] = useState(createSynthesizer)
  const [step, setStep] = useState<Step>('idle')
  // 지금(끝났으면 마지막) 대화. 새 대화를 시작할 때 비운다
  const [messages, setMessages] = useState<VoiceMessage[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  // 대화를 시작하거나 끝내면 올린다. 그 전에 시작한 듣기·읽기·서버 응답·화면 반영의 뒤처리는 버린다
  const session = useRef(0)
  // 대화와 고른 내용의 최신 값(응답을 기다린 뒤에는 여기서 읽는다)
  const messagesRef = useRef<VoiceMessage[]>([])
  const draftRef = useRef<VoiceDraft>(EMPTY_VOICE_DRAFT)
  // 이 대화에서 마지막으로 가격이 나와 화면에 보인 고른 내용. 신청은 이것과 같은 내용일 때만 한다
  const pricedRef = useRef<VoiceSelection | null>(null)
  // 마지막으로 듣기 시작한 인식기. 대화를 끝내거나 화면을 떠나면 듣기를 그만둔다(마이크를 놓는다)
  const recognizerRef = useRef<Recognizer | null>(null)
  const logRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    const current = session
    const recognizer = recognizerRef
    return () => {
      current.current += 1
      recognizer.current?.abort()
      synthesizer.cancel()
    }
  }, [synthesizer])

  // 화면에서 손으로 고르거나 신청했으면 화면이 음성이 가격을 낸 내용과 달라졌다. 다음 신청은 다시 계산해 확인받는다
  useEffect(() => {
    pricedRef.current = null
  }, [screenEdits])

  // 대화가 길어지면 마지막 줄이 보이게 내린다
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages])

  // 막히면 대화를 끝내고 지난 알림을 지운다(풀린 뒤 낡은 알림이 다시 보이지 않게)
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) {
      setStep('idle')
      setNotice(null)
    }
  }
  // 그린 직후 같은 차례에 정리해, 그사이 도착한 응답이 막힌 패널에서 대화를 잇지 못하게 한다
  useLayoutEffect(() => {
    if (!disabled) return
    session.current += 1
    recognizerRef.current?.abort()
    recognizerRef.current = null
    synthesizer.cancel()
  }, [disabled, synthesizer])

  function addLine(line: VoiceMessage) {
    messagesRef.current = [...messagesRef.current, line]
    setMessages(messagesRef.current)
  }

  // 시스템의 말을 대화에 더하고 다 읽을 때까지 기다린다. 그사이 대화가 끝났으면 false
  async function say(text: string, seq: number): Promise<boolean> {
    addLine({ speaker: 'SYSTEM', text })
    setStep('speaking')
    await synthesizer.speak(text)
    return seq === session.current
  }

  // 인사를 보이고 읽은 뒤 듣기 시작한다. 인식에 실패해 멈춘 대화에서 부르면("다시 말하기") 인사 없이 다시 듣는다
  function startVoiceInput() {
    setNotice(null)
    if (step === 'paused') {
      listen(session.current)
      return
    }
    const seq = ++session.current
    recognizerRef.current?.abort()
    messagesRef.current = []
    setMessages([])
    draftRef.current = EMPTY_VOICE_DRAFT
    pricedRef.current = null
    void say(greetingFor(AuthStore.name), seq).then((current) => {
      if (current) listen(seq)
    })
  }

  function listen(seq: number) {
    recognizerRef.current?.abort()
    const recognizer = createRecognizer()
    // 한 번 들은 말만 보낸다(그 뒤에 온 결과·실패는 버린다)
    const own = () => seq === session.current && recognizerRef.current === recognizer
    recognizer.onresult = (text) => {
      if (!own()) return
      recognizerRef.current = null
      void sendUtterance(text, seq)
    }
    recognizer.onerror = (reason) => {
      if (!own()) return
      recognizerRef.current = null
      recognitionFailed(reason)
    }
    recognizerRef.current = recognizer
    // 듣는 중을 먼저 보인다. recognize가 곧바로 실패를 알리면 그 알림이 덮는다
    setStep('listening')
    recognizer.recognize()
  }

  // 마이크 권한이 거부됐으면 다시 말해도 같은 실패라 대화를 끝낸다. 그 밖의 실패는 대화를 두고 다시 말하게 한다
  function recognitionFailed(reason: RecognitionFailure) {
    if (reason === 'not-allowed') {
      stopVoiceInput()
      setNotice(MIC_DENIED_MESSAGE)
      return
    }
    setStep('paused')
    setNotice(reason === 'no-speech' ? NO_SPEECH_MESSAGE : RECOGNITION_FAILED_MESSAGE)
  }

  async function sendUtterance(text: string, seq: number) {
    addLine({ speaker: 'CUSTOMER', text })
    setStep('waiting')
    const request: VoiceChatRequest = { messages: messagesRef.current, draft: draftRef.current }
    let body: unknown
    try {
      body = await ApiClient.post<unknown>('/api/v1/voice/chat', request)
    } catch (error) {
      if (seq !== session.current) return
      stopVoiceInput()
      // 503이면 서버 문구는 보이지 않는다(설계 3장 VoiceInputPanel)
      if (hasStatus(error, 503)) setNotice(VOICE_UNAVAILABLE_MESSAGE)
      else if (hasStatus(error, 400)) setNotice(error.message)
      else {
        showError(error)
        setNotice(STOPPED_MESSAGE)
      }
      return
    }
    if (seq !== session.current) return
    if (!isVoiceChatResponse(body)) {
      showError(new Error(`voice/chat 응답 모양이 다르다: ${JSON.stringify(body)}`))
      stopAfterFailure()
      return
    }
    await answer(body, seq)
  }

  // TALK면 고른 내용이 처음 다 정해졌거나 바뀌었을 때 화면의 칸을 채운 뒤 답을 읽고 다시 듣는다.
  // APPLY면 답을 읽고 신청하며, STOP이면 답을 읽고 대화를 끝낸다
  async function answer({ reply, draft, next }: VoiceChatResponse, seq: number) {
    const previousDraft = draftRef.current
    const selection = selectionOf(draft)
    draftRef.current = draft
    if (next === 'STOP') {
      if (await say(reply, seq)) stopVoiceInput()
      return
    }
    if (next === 'APPLY') {
      // 서버는 상품·투어 등급·인원이 다 정해졌을 때만 APPLY를 준다
      if (!selection) {
        showError(new Error(`voice/chat이 고르지 않은 칸이 있는 채로 APPLY를 줬다: ${JSON.stringify(draft)}`))
        stopAfterFailure()
        return
      }
      // 지금 화면에 가격이 나와 있는 내용과 같을 때만 신청하고, 아니면 다시 계산해 확인받는다.
      // 답을 읽는 동안 화면을 손으로 바꿨을 수 있어 읽은 뒤에도 본다
      const confirmAgain = () => talkOn(CONFIRM_AGAIN_MESSAGE, draft, previousDraft, seq, { confirmAgain: true })
      if (!sameSelection(pricedRef.current, selection)) return confirmAgain()
      if (!(await say(reply, seq))) return
      if (!sameSelection(pricedRef.current, selection)) return confirmAgain()
      await applyFromVoice(selection, seq)
      return
    }
    await talkOn(reply, draft, previousDraft, seq)
  }

  // 고른 내용이 처음 다 정해졌거나 바뀌었으면 칸을 채워 가격을 계산하고, 덜 정해졌으면 정해진 만큼 화면에 바로 보인 뒤
  // 말을 읽고 다시 듣는다. 가격 계산이 거부되면 말 뒤에 거부 문구를 읽는다. confirmAgain(가격이 나왔다는 말로 다시
  // 확인받기)이면 늘 다시 계산하고, 거부되면 거부 문구만 읽는다
  async function talkOn(
    reply: string,
    draft: VoiceDraft,
    previousDraft: VoiceDraft,
    seq: number,
    { confirmAgain = false } = {},
  ) {
    const selection = selectionOf(draft)
    let rejection: string | null = null
    if (selection && (confirmAgain || !sameSelection(selectionOf(previousDraft), selection))) {
      setStep('working')
      const outcome = await applySelection(selection)
      if (seq !== session.current) return
      if (outcome.status === 'failed') return stopAfterFailure()
      // 거부되면 화면에 가격이 없다. 거부 문구도 대화에 들어가 다음 요청에서 서버가 본다
      pricedRef.current = outcome.status === 'priced' ? selection : null
      if (outcome.status === 'rejected') rejection = outcome.error.message
    } else if (!selection && !sameChoice(previousDraft, draft)) {
      setStep('working')
      pricedRef.current = null
      await previewSelection(draft)
      if (seq !== session.current) return
    }
    const lines = rejection === null ? [reply] : confirmAgain ? [rejection] : [reply, rejection]
    for (const line of lines) {
      if (!(await say(line, seq))) return
    }
    listen(seq)
  }

  async function continueAfter(message: string, seq: number) {
    if (await say(message, seq)) listen(seq)
  }

  // 대화의 고른 내용으로 화면을 다시 맞춰 가격을 계산한 뒤 신청한다
  async function applyFromVoice(selection: VoiceSelection, seq: number) {
    setStep('working')
    const priced = await applySelection(selection)
    if (seq !== session.current) return
    if (priced.status === 'failed') return stopAfterFailure()
    if (priced.status === 'rejected') {
      pricedRef.current = null
      return continueAfter(priced.error.message, seq)
    }
    const result = await applyTour()
    if (seq !== session.current) return
    if (result.status === 'applied') {
      if (await say(appliedMessage(result.tourStatus), seq)) stopVoiceInput()
      return
    }
    // 거부되면 화면이 등급·인원을 다시 받거나 상품 목록으로 돌아가 가격이 없다
    if (result.status === 'rejected') {
      pricedRef.current = null
      return continueAfter(result.error.message, seq)
    }
    // 결과를 모르면 화면이 "결과 확인"을 보이고 이 패널을 막는다
    if (result.status === 'unknown') stopVoiceInput()
    else stopAfterFailure()
  }

  // 실패로 대화를 끝내고 패널에 알린다(화면을 다시 고른 때처럼 공용 알림이 없는 실패도 있다)
  function stopAfterFailure() {
    stopVoiceInput()
    setNotice(STOPPED_MESSAGE)
  }

  // 대화를 끝낸다. 듣기·읽기를 멈추고(마이크를 놓고) 그 뒤에 도착한 서버 응답은 버린다. 이미 보낸 신청은 되돌리지 않는다
  function stopVoiceInput() {
    session.current += 1
    recognizerRef.current?.abort()
    recognizerRef.current = null
    synthesizer.cancel()
    setStep('idle')
    setNotice(null)
  }

  const talking = step !== 'idle'
  // 두 번 누르기의 둘째 클릭은 버린다(뒤이어 읽는 말까지 건너뛰지 않게)
  function skipSpeech(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail > 1 || step !== 'speaking') return
    synthesizer.cancel()
  }
  // 대화도 알림도 없는 처음 상태면 카드를 줄인다(패널이 넓게 놓이면 설명 옆에 시작 단추, 오른쪽 칸처럼 좁으면 설명 아래)
  const compact = supported && !disabled && !notice && !talking && messages.length === 0

  return (
    <section aria-label="음성으로 고르기" className="@container">
      <Card
        className={cn('ring-primary/30', compact && 'gap-3 py-4 @md:flex-row @md:items-center @md:justify-between')}
      >
        <CardHeader className={cn(compact && '@md:min-w-0 @md:flex-1')}>
          <CardTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Mic className="size-4" />
            </span>
            음성으로 고르기
          </CardTitle>
          {compact && <p className="text-sm text-muted-foreground">{INTRO_MESSAGE}</p>}
        </CardHeader>
        <CardContent className={cn('space-y-4', compact && '@md:w-auto @md:shrink-0')}>
          {!supported && (
            <Alert>
              <AlertDescription>{UNSUPPORTED_MESSAGE}</AlertDescription>
            </Alert>
          )}
          {supported && (
            <>
              {disabled && (
                <Alert>
                  <AlertDescription>{DISABLED_MESSAGE}</AlertDescription>
                </Alert>
              )}
              {messages.length === 0 && !compact && <p className="text-sm text-muted-foreground">{INTRO_MESSAGE}</p>}
              {messages.length > 0 && (
                <ol ref={logRef} aria-label="대화" className="max-h-60 space-y-2 overflow-y-auto lg:max-h-[55vh]">
                  {messages.map((line, index) => (
                    <li
                      key={index}
                      className={cn(
                        'w-fit max-w-[85%] rounded-lg px-3 py-2 text-sm',
                        line.speaker === 'SYSTEM' ? 'bg-muted' : 'ml-auto bg-primary text-primary-foreground',
                      )}
                    >
                      <p className="text-xs opacity-70">{line.speaker === 'SYSTEM' ? '시스템' : '고객'}</p>
                      <p>{line.text}</p>
                    </li>
                  ))}
                </ol>
              )}
              {notice && (
                <Alert variant="destructive">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
              {talking && step !== 'paused' && <p className="text-sm text-muted-foreground">{STEP_MESSAGES[step]}</p>}
              <div className="flex flex-wrap gap-2">
                {step === 'idle' && (
                  <Button
                    className={compact ? 'w-full @md:min-w-28' : undefined}
                    onClick={(event) => {
                      // 그만두기를 두 번 누른 둘째 클릭이 이 자리에 오면 버린다
                      if (event.detail <= 1) startVoiceInput()
                    }}
                    disabled={disabled}
                  >
                    음성으로 신청하기
                  </Button>
                )}
                {/* 그만두기는 대화 중 늘 첫 자리(건너뛴 자리를 또 눌러도 대화가 끝나지 않게) */}
                {talking && (
                  <Button variant="outline" onClick={stopVoiceInput}>
                    그만두기
                  </Button>
                )}
                {step === 'paused' && (
                  <Button variant="outline" onClick={startVoiceInput} disabled={disabled}>
                    다시 말하기
                  </Button>
                )}
                {talking && step !== 'paused' && (
                  <Button
                    variant="outline"
                    aria-disabled={step !== 'speaking'}
                    className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                    onClick={skipSpeech}
                  >
                    말 건너뛰기
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
