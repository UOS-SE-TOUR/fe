import { formatDate } from '@/lib/format'
import type { Theme, TourLevel, TourStatus } from '@/lib/labels'
import { ApiClient } from '@/modules/ApiClient'

// 상품 조회·가격 계산·신청 API의 본문 모양. 이름은 be record·Swagger 스키마와 같다

export interface TourSummary {
  tourId: number
  title: string
  // YYYY-MM-DD
  departureDate: string
  duration: number
  remainingSeats: number
  status: TourStatus
}

export interface LevelDetail {
  level: TourLevel
  name: string
  price: number
  hotelGrade: number
  meal: string
  includesChampagne: boolean
}

export interface TourLevelsResponse {
  service: string
  souvenir: string
  vehicle: string
  levels: LevelDetail[]
}

export interface TourOptionItem {
  optionId: number
  name: string
  // 받은 투어 등급을 기준으로 한 1인 요금 차이(원). 더 싼 호텔·식사면 음수
  priceDiff: number
}

export interface TourOptionsResponse {
  hotels: TourOptionItem[]
  transports: TourOptionItem[]
  meals: TourOptionItem[]
  extras: TourOptionItem[]
}

export type OptionCategory = 'HOTEL' | 'TRANSPORT' | 'MEAL' | 'EXTRA'

export interface QuoteRequest {
  tourId: number
  level: TourLevel
  headcount: number
  optionIds: number[]
}

export interface SelectedOption {
  optionId: number
  category: OptionCategory
  name: string
  priceDiff: number
}

export interface QuoteSummary {
  tourId: number
  title: string
  departureDate: string
  duration: number
  level: TourLevel
  levelName: string
  headcount: number
  options: SelectedOption[]
}

export interface PriceQuote {
  summary: QuoteSummary
  totalPrice: number
  discount: number
  finalPrice: number
}

export interface ApplyTourResponse {
  bookingId: number
  status: TourStatus
}

export interface PreviousTourResponse {
  bookingId: number
  tourId: number
  title: string
  // YYYY-MM-DD
  departureDate: string
  duration: number
  level: TourLevel
  levelName: string
  headcount: number
  // 신청할 때 정해진 최종 가격(원, 할인 뒤)
  finalPrice: number
}

// 내 신청 한 줄. 이전 여행 한 줄에 신청한 때·상품의 지금 상태·확정까지 남은 인원을 더했다
export interface MyBookingResponse extends PreviousTourResponse {
  // UTC ISO 8601. 초 아래 자리는 없거나 자릿수가 다를 수 있다
  appliedAt: string
  status: TourStatus
  // 모집 중일 때만 1 이상이고 다른 상태에서는 0. 허니문은 2명 단위
  headcountToConfirm: number
}

export function isPreviousTour(value: unknown): value is PreviousTourResponse {
  if (typeof value !== 'object' || value === null) return false
  const tour = value as Partial<PreviousTourResponse>
  return (
    typeof tour.bookingId === 'number' &&
    typeof tour.tourId === 'number' &&
    typeof tour.title === 'string' &&
    typeof tour.departureDate === 'string' &&
    typeof tour.duration === 'number' &&
    typeof tour.level === 'string' &&
    typeof tour.levelName === 'string' &&
    typeof tour.headcount === 'number' &&
    typeof tour.finalPrice === 'number'
  )
}

export function isMyBooking(value: unknown): value is MyBookingResponse {
  if (!isPreviousTour(value)) return false
  const booking = value as Partial<MyBookingResponse>
  return (
    typeof booking.appliedAt === 'string' &&
    typeof booking.status === 'string' &&
    typeof booking.headcountToConfirm === 'number'
  )
}

// 음성 대화(be voice/chat). SYSTEM은 화면의 인사·서버의 답·화면이 더한 거부 문구, CUSTOMER는 고객이 한 말이다
export type VoiceSpeaker = 'SYSTEM' | 'CUSTOMER'

// TALK는 고객의 말을 더 듣고, APPLY는 고른 내용으로 신청하며, STOP은 대화를 끝낸다
export type VoiceNext = 'TALK' | 'APPLY' | 'STOP'

export interface VoiceMessage {
  speaker: VoiceSpeaker
  text: string
}

// 대화에서 지금까지 고른 내용. 고르지 않은 칸은 null, 옵션은 빈 목록이다
export interface VoiceDraft {
  theme: Theme | null
  tourId: number | null
  level: TourLevel | null
  headcount: number | null
  optionIds: number[]
}

export interface VoiceChatRequest {
  // 지금까지의 대화 전체. 첫 줄은 인사, 마지막 줄은 고객이 방금 한 말이다
  messages: VoiceMessage[]
  draft: VoiceDraft
}

export interface VoiceChatResponse {
  reply: string
  draft: VoiceDraft
  next: VoiceNext
}

export const EMPTY_VOICE_DRAFT: VoiceDraft = { theme: null, tourId: null, level: null, headcount: null, optionIds: [] }

function isNullable(value: unknown, type: 'string' | 'number'): boolean {
  return value === null || typeof value === type
}

function isVoiceDraft(value: unknown): value is VoiceDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    isNullable(draft.theme, 'string') &&
    isNullable(draft.tourId, 'number') &&
    isNullable(draft.level, 'string') &&
    isNullable(draft.headcount, 'number') &&
    Array.isArray(draft.optionIds) &&
    draft.optionIds.every((id) => typeof id === 'number')
  )
}

export function isVoiceChatResponse(value: unknown): value is VoiceChatResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Record<string, unknown>
  return (
    typeof response.reply === 'string' &&
    response.reply.trim() !== '' &&
    isVoiceDraft(response.draft) &&
    (response.next === 'TALK' || response.next === 'APPLY' || response.next === 'STOP')
  )
}

// 받아 오는 상품 목록의 상태
export type ToursState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; list: TourSummary[] }

// 서버(be Tour.checkSeats)의 문구. 옵션을 바꿀 때 이 400이면 투어 등급과 인원을 다시 받는다(설계 5.6)
export const SEAT_SHORTAGE_MESSAGE = '남은 자리보다 인원이 많습니다.'
export const HEADCOUNT_MESSAGE = '인원은 1 이상의 정수로 입력해 주세요.'
// be가 받는 인원(Integer)의 최댓값
const MAX_HEADCOUNT = 2_147_483_647

// 인원 칸의 글자를 읽는다. 숫자만 쓴 1 이상의 정수가 아니면 null(상품 선택 화면과 음성 입력이 같은 규칙을 쓴다)
export function parseHeadcount(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= 1 && value <= MAX_HEADCOUNT ? value : null
}

// 지금 신청할 수 있는 상품인지. 아니면 목록에 상태(마감 등)로 보이고 고를 수 없다
export function canApply(tour: TourSummary): boolean {
  return (tour.status === 'RECRUITING' || tour.status === 'CONFIRMED') && tour.remainingSeats > 0
}

// 상품 목록 한 줄에 제목과 함께 보이는 설명
export function tourSummaryLine(tour: TourSummary): string {
  return `${formatDate(tour.departureDate)} 출발 · ${tour.duration}일 · 남은 자리 ${tour.remainingSeats}명`
}

// 그 테마의 상품 목록. 출발일이 오늘보다 뒤인 상품을 마감 상품까지 출발일 순으로 준다
export function getTours(theme: Theme): Promise<TourSummary[]> {
  return ApiClient.get<TourSummary[]>(`/api/v1/tours?theme=${theme}`)
}
