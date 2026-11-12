import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatDate } from '@/lib/format'
import { themes, tourLevels, tourStatusLabel, type Theme, type TourLevel } from '@/lib/labels'
import { canApply, getTours, type TourSummary } from '@/lib/tours'
import { ApiClient, hasStatus, showError } from '@/modules/ApiClient'
import { SpeechRecognizer, type RecognitionFailure, type Recognizer } from '@/modules/SpeechRecognizer'
import type { ApplySelection, VoiceSelection } from '@/pages/TourSelectPage'

// voice/parse의 본문(be VoiceParseRequest·TourSelection). 뽑지 못한 항목은 null이다
interface VoiceParseRequest {
  text: string
}

export interface TourSelection {
  theme: Theme | null
  // YYYY-MM-DD
  departureDate: string | null
  level: TourLevel | null
  headcount: number | null
  // 테마와 출발일이 같은 상품. 마감 상품도 섞여 온다
  candidates: TourSummary[]
}

const UNSUPPORTED_MESSAGE = '이 브라우저에서는 음성 입력을 쓸 수 없습니다. 크롬에서 열거나, 아래에서 직접 골라 주세요.'
const MIC_DENIED_MESSAGE = '마이크 권한이 없어 음성 입력을 쓸 수 없습니다. 아래에서 직접 골라 주세요.'
const RECOGNITION_FAILED_MESSAGE = '음성을 인식하지 못해 음성 입력을 쓸 수 없습니다. 아래에서 직접 골라 주세요.'
const VOICE_UNAVAILABLE_MESSAGE = '지금은 음성으로 고를 수 없습니다. 아래에서 직접 골라 주세요.'
const NO_SPEECH_MESSAGE = '말소리를 듣지 못했습니다. 다시 말해 주세요.'
const MISSING_MESSAGE = '알아듣지 못한 칸이 있습니다. 빈 칸을 채우거나 다시 말해 주세요.'
const NO_CANDIDATE_MESSAGE = '그 테마와 출발일에 고를 수 있는 상품이 없습니다. 테마나 출발일을 고치거나 다시 말해 주세요.'
const CHOOSE_MESSAGE = '출발일이 같은 상품이 여럿입니다. 하나를 골라 주세요.'
const SPEAK_AGAIN_MESSAGE = '내용을 고치거나 다시 말해 주세요.'
const PRICED_MESSAGE = '말한 내용으로 가격을 계산했습니다. 아래에서 확인해 주세요.'

type CandidatesState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; list: TourSummary[] }

// 받은 내용을 고객이 고치는 칸. 뽑지 못한 칸은 빈 값이다
interface Draft {
  theme: Theme | ''
  departureDate: string
  level: TourLevel | ''
  headcount: string
  candidates: CandidatesState
  tourId: number | null
  // 확인했더니 가격 계산이 거부한 문구. 칸을 고치면 지운다
  rejection: string | null
}

// listening은 듣는 중, parsing은 알아들은 말을 서버가 푸는 중, applying은 확인한 내용으로 가격을 계산하는 중이다
type Step = 'idle' | 'listening' | 'parsing' | 'applying'

interface Notice {
  tone: 'error' | 'info'
  message: string
}

function choosableOf(candidates: CandidatesState): TourSummary[] {
  return candidates.status === 'loaded' ? candidates.list.filter(canApply) : []
}

// 고를 수 있는 후보가 하나면 그 상품을 쓴다. 둘 이상이면 고객이 고른다. keep은 고객이 이미 고른 상품으로, 아직 고를 수 있으면 둔다
function pickTour(list: TourSummary[], keep: number | null = null): number | null {
  const choosable = choosableOf({ status: 'loaded', list })
  if (keep !== null && choosable.some((tour) => tour.tourId === keep)) return keep
  return choosable.length === 1 ? choosable[0].tourId : null
}

function isMissing(draft: Draft): boolean {
  return !draft.theme || !draft.departureDate || !draft.level || !draft.headcount.trim()
}

// 확인할 수 있는 내용이면 상품 선택 화면에 넘길 값을 돌려준다. 인원이 정수인지는 상품 선택 화면이 본다
function selectionOf(draft: Draft): VoiceSelection | null {
  const { theme, level, tourId } = draft
  if (isMissing(draft) || !theme || !level || tourId === null) return null
  if (!choosableOf(draft.candidates).some((tour) => tour.tourId === tourId)) return null
  return { theme, tourId, level, headcount: Number(draft.headcount.trim()) }
}

interface VoiceInputPanelProps {
  applySelection: ApplySelection
  // 테스트는 가짜를 넣는다(테스트 환경에는 브라우저 음성인식이 없다)
  createRecognizer?: () => Recognizer
}

function newRecognizer(): Recognizer {
  return new SpeechRecognizer()
}

export function VoiceInputPanel({ applySelection, createRecognizer = newRecognizer }: VoiceInputPanelProps) {
  const [supported] = useState(() => createRecognizer().isSupported())
  const [step, setStep] = useState<Step>('idle')
  const [heard, setHeard] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // 다시 말하기 시작하면 올린다. 그 전에 들은 말의 응답은 버린다
  const session = useRef(0)
  // 후보 상품을 다시 찾을 때마다 올린다. 마지막에 찾은 것만 쓴다
  const candidatesRequest = useRef(0)
  // 마지막으로 받은 테마의 상품 목록. 출발일만 고칠 때는 다시 받지 않는다(날짜 칸은 칠 때마다 바뀐다)
  const themeTours = useRef<{ theme: Theme; list: TourSummary[] } | null>(null)
  // 마지막으로 듣기 시작한 인식기. 화면을 떠나면 듣기를 그만둔다(마이크를 놓는다)
  const recognizerRef = useRef<Recognizer | null>(null)

  useEffect(() => {
    const current = session
    const recognizer = recognizerRef
    return () => {
      current.current += 1
      recognizer.current?.abort()
    }
  }, [])

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  // 듣기를 시작하고 말할 내용을 안내한다(설계 5.5 startVoiceInput → recognize → showVoiceGuide)
  function startVoiceInput() {
    const seq = ++session.current
    candidatesRequest.current += 1
    themeTours.current = null
    setDraft(null)
    setNotice(null)
    recognizerRef.current?.abort()
    const recognizer = createRecognizer()
    recognizer.onresult = (text) => {
      if (seq === session.current) void parse(text, seq)
    }
    recognizer.onerror = (reason) => {
      if (seq === session.current) recognitionFailed(reason)
    }
    recognizerRef.current = recognizer
    // 안내는 다시 그릴 때 보이므로 듣기가 먼저 시작된다. recognize가 곧바로 실패를 알리면 그 알림이 안내를 덮는다
    showVoiceGuide()
    recognizer.recognize()
  }

  function showVoiceGuide() {
    setStep('listening')
  }

  // 듣기를 그만둔다(권한 창을 닫지 않았거나 인식이 끝나지 않아도 다시 말하거나 직접 고를 수 있게)
  function stopVoiceInput() {
    session.current += 1
    recognizerRef.current?.abort()
    setStep('idle')
  }

  function recognitionFailed(reason: RecognitionFailure) {
    setStep('idle')
    const message =
      reason === 'no-speech' ? NO_SPEECH_MESSAGE : reason === 'not-allowed' ? MIC_DENIED_MESSAGE : RECOGNITION_FAILED_MESSAGE
    setNotice({ tone: 'error', message })
  }

  async function parse(text: string, seq: number) {
    setHeard(text)
    setStep('parsing')
    try {
      const selection = await ApiClient.post<TourSelection>('/api/v1/voice/parse', { text } satisfies VoiceParseRequest)
      if (seq === session.current) showSelection(selection)
    } catch (error) {
      if (seq !== session.current) return
      setStep('idle')
      // 503이면 서버 문구는 보이지 않는다(설계 3장 VoiceInputPanel)
      if (hasStatus(error, 503)) setNotice({ tone: 'error', message: VOICE_UNAVAILABLE_MESSAGE })
      else if (hasStatus(error, 400)) setNotice({ tone: 'error', message: error.message })
      else showError(error)
    }
  }

  // 받은 내용을 칸에 채운다. 뽑지 못한 칸은 비워 둔다
  function showSelection(selection: TourSelection) {
    setStep('idle')
    setDraft({
      theme: selection.theme ?? '',
      departureDate: selection.departureDate ?? '',
      level: selection.level ?? '',
      headcount: String(selection.headcount ?? ''),
      candidates: { status: 'loaded', list: selection.candidates },
      tourId: pickTour(selection.candidates),
      rejection: null,
    })
  }

  // 테마나 출발일을 고치면 받은 후보가 맞지 않는다. 그 테마의 상품 목록에서 출발일이 같은 상품으로 후보를 다시 정한다
  function changeTarget(theme: Theme | '', departureDate: string) {
    updateDraft({ theme, departureDate, rejection: null })
    findCandidates(theme, departureDate)
  }

  // fresh면 받아 둔 목록을 쓰지 않고 새로 받는다(불러오지 못했거나, 가격 계산이 거부해 남은 자리·상태가 바뀌었을 수 있을 때)
  function findCandidates(
    theme: Theme | '',
    departureDate: string,
    { fresh = false, keep = null }: { fresh?: boolean; keep?: number | null } = {},
  ) {
    const request = ++candidatesRequest.current
    const show = (tours: TourSummary[]) => {
      const list = tours.filter((tour) => tour.departureDate === departureDate)
      updateDraft({ candidates: { status: 'loaded', list }, tourId: pickTour(list, keep) })
    }
    if (theme === '' || departureDate === '') {
      show([])
      return
    }
    const saved = themeTours.current
    if (!fresh && saved?.theme === theme) {
      show(saved.list)
      return
    }
    updateDraft({ candidates: { status: 'loading' }, tourId: null })
    getTours(theme).then(
      (tours) => {
        if (request !== candidatesRequest.current) return
        themeTours.current = { theme, list: tours }
        show(tours)
      },
      (error: unknown) => {
        if (request !== candidatesRequest.current) return
        showError(error)
        updateDraft({ candidates: { status: 'failed' } })
      },
    )
  }

  // 고객이 확인한 내용으로 상품 선택 화면이 가격을 계산한다(설계 5.5 confirmSelection → applySelection)
  async function confirmSelection() {
    const selection = draft && step === 'idle' ? selectionOf(draft) : null
    if (!draft || !selection) return
    const seq = session.current
    setStep('applying')
    const outcome = await applySelection(selection)
    if (seq !== session.current) return
    setStep('idle')
    if (outcome.status === 'priced') {
      setDraft(null)
      setNotice({ tone: 'info', message: PRICED_MESSAGE })
    } else if (outcome.status === 'rejected') {
      // 409여도 상품 목록으로 돌아가지 않고 다시 말하게 한다(상품 선택 화면도 그대로 둔다).
      // 그사이 마감되었거나 남은 자리가 줄었을 수 있어 후보를 새로 받는다(고른 상품은 아직 고를 수 있으면 둔다)
      updateDraft({ rejection: outcome.error.message })
      findCandidates(selection.theme, draft.departureDate, { fresh: true, keep: selection.tourId })
    }
    // failed는 상품 선택 화면이 이미 알렸다. 칸을 그대로 두어 다시 확인할 수 있다
  }

  const busy = step !== 'idle'

  return (
    <section aria-label="음성으로 고르기">
      <Card>
        <CardHeader>
          <CardTitle>음성으로 고르기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supported && (
            <Alert>
              <AlertDescription>{UNSUPPORTED_MESSAGE}</AlertDescription>
            </Alert>
          )}
          {supported && (
            <>
              {notice && (
                <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{notice.message}</AlertDescription>
                </Alert>
              )}
              {step === 'idle' && !draft && (
                <p className="text-sm text-muted-foreground">
                  말하기를 누르고 테마, 출발일, 투어 등급, 인원을 말하면 칸을 채워 드립니다.
                </p>
              )}
              {step === 'listening' && (
                <div className="space-y-1">
                  <p>듣고 있습니다. 테마, 출발일, 투어 등급, 인원을 말해 주세요.</p>
                  <p className="text-sm text-muted-foreground">예: “12월 20일에 출발하는 골프 투어, 그랜드 등급으로 2명”</p>
                </div>
              )}
              {step === 'parsing' && (
                <div className="space-y-1">
                  <p className="text-sm">알아들은 말: “{heard}”</p>
                  <p className="text-sm text-muted-foreground">말한 내용을 읽는 중입니다.</p>
                </div>
              )}
              {draft && (step === 'idle' || step === 'applying') && (
                <DraftForm
                  draft={draft}
                  heard={heard}
                  applying={step === 'applying'}
                  onChangeTarget={changeTarget}
                  onChange={(patch) => updateDraft({ ...patch, rejection: null })}
                  onRetryCandidates={() =>
                    findCandidates(draft.theme, draft.departureDate, { fresh: true, keep: draft.tourId })
                  }
                  onConfirm={() => void confirmSelection()}
                />
              )}
              {step === 'listening' ? (
                <Button variant="outline" onClick={stopVoiceInput}>
                  그만 듣기
                </Button>
              ) : (
                <Button variant={draft ? 'outline' : 'default'} onClick={startVoiceInput} disabled={busy}>
                  {draft ? '다시 말하기' : '말하기'}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

interface DraftFormProps {
  draft: Draft
  heard: string
  applying: boolean
  onChangeTarget(theme: Theme | '', departureDate: string): void
  onChange(patch: Pick<Partial<Draft>, 'level' | 'headcount' | 'tourId'>): void
  onRetryCandidates(): void
  onConfirm(): void
}

function DraftForm({ draft, heard, applying, ...props }: DraftFormProps) {
  const { candidates } = draft
  const choosable = choosableOf(candidates)
  const missing = isMissing(draft)
  const noCandidate = !!draft.theme && !!draft.departureDate && candidates.status === 'loaded' && choosable.length === 0
  const messages = [
    ...(draft.rejection ? [draft.rejection, SPEAK_AGAIN_MESSAGE] : []),
    ...(missing ? [MISSING_MESSAGE] : []),
    ...(noCandidate ? [NO_CANDIDATE_MESSAGE] : []),
  ]

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <p className="text-sm">알아들은 말: “{heard}”</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="voice-theme">테마</Label>
          <NativeSelect
            id="voice-theme"
            className="w-full"
            value={draft.theme}
            disabled={applying}
            onChange={(event) => props.onChangeTarget(event.target.value as Theme | '', draft.departureDate)}
          >
            <NativeSelectOption value="">테마 선택</NativeSelectOption>
            {themes.map((item) => (
              <NativeSelectOption key={item.value} value={item.value}>
                {item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-date">출발일</Label>
          <Input
            id="voice-date"
            type="date"
            value={draft.departureDate}
            disabled={applying}
            onChange={(event) => props.onChangeTarget(draft.theme, event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-level">투어 등급</Label>
          <NativeSelect
            id="voice-level"
            className="w-full"
            value={draft.level}
            disabled={applying}
            onChange={(event) => props.onChange({ level: event.target.value as TourLevel | '' })}
          >
            <NativeSelectOption value="">투어 등급 선택</NativeSelectOption>
            {tourLevels.map((item) => (
              <NativeSelectOption key={item.value} value={item.value}>
                {item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="voice-headcount">인원</Label>
          <Input
            id="voice-headcount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.headcount}
            disabled={applying}
            onChange={(event) => props.onChange({ headcount: event.target.value })}
          />
        </div>
      </div>

      {candidates.status === 'loading' && <p className="text-sm text-muted-foreground">후보 상품을 찾는 중입니다.</p>}
      {candidates.status === 'failed' && (
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">후보 상품을 불러오지 못했습니다.</p>
          <Button type="button" variant="outline" onClick={props.onRetryCandidates} disabled={applying}>
            다시 찾기
          </Button>
        </div>
      )}
      {candidates.status === 'loaded' && candidates.list.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">후보 상품</legend>
          <RadioGroup
            value={draft.tourId === null ? '' : String(draft.tourId)}
            onValueChange={(value) => props.onChange({ tourId: Number(value) })}
            disabled={applying}
          >
            {candidates.list.map((tour) => (
              <div key={tour.tourId} className="flex items-start gap-2">
                <RadioGroupItem
                  id={`voice-tour-${tour.tourId}`}
                  value={String(tour.tourId)}
                  disabled={!canApply(tour)}
                  className="mt-0.5"
                />
                <Label htmlFor={`voice-tour-${tour.tourId}`} className="flex flex-col items-start gap-1">
                  <span className="flex items-center gap-2">
                    {tour.title}
                    <Badge variant={canApply(tour) ? 'secondary' : 'outline'}>{tourStatusLabel(tour.status)}</Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(tour.departureDate)} 출발 · {tour.duration}일 · 남은 자리 {tour.remainingSeats}명
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
          {choosable.length > 1 && draft.tourId === null && (
            <p className="text-sm text-muted-foreground">{CHOOSE_MESSAGE}</p>
          )}
        </fieldset>
      )}

      {messages.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Button type="button" onClick={props.onConfirm} disabled={applying || !selectionOf(draft)}>
        {applying ? '가격을 계산하는 중' : '확인'}
      </Button>
    </form>
  )
}
