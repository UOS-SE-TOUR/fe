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
  // 신청하거나 마지막으로 바꿀 때 정해진 최종 가격(원, 할인 뒤)
  finalPrice: number
}

// 내 신청 한 줄. 이전 여행 한 줄에 신청한 때·상품의 지금 상태·확정까지 남은 인원과, 바꾸기에 쓰는 두 칸을 더했다.
// 신청을 바꾸면 바뀐 신청도 이 모양으로 온다
export interface MyBookingResponse extends PreviousTourResponse {
  // 지금 고른 옵션의 ID. 고르지 않은 종류는 그 등급의 기본 제공이다
  optionIds: number[]
  // UTC ISO 8601. 초 아래 자리는 없거나 자릿수가 다를 수 있다
  appliedAt: string
  status: TourStatus
  // 모집 중일 때만 1 이상이고 다른 상태에서는 0. 허니문은 2명 단위
  headcountToConfirm: number
  // 지금 투어 등급과 옵션을 바꿀 수 있다(출발 전이고 모집 중·확정·마감)
  changeable: boolean
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
    Array.isArray(booking.optionIds) &&
    booking.optionIds.every((optionId) => typeof optionId === 'number') &&
    typeof booking.appliedAt === 'string' &&
    typeof booking.status === 'string' &&
    typeof booking.headcountToConfirm === 'number' &&
    typeof booking.changeable === 'boolean'
  )
}

// 가격 계산 응답인지. 가격 요약(PriceSummary)이 그리는 칸만 본다
export function isPriceQuote(value: unknown): value is PriceQuote {
  if (typeof value !== 'object' || value === null) return false
  const { summary, totalPrice, discount, finalPrice } = value as Partial<PriceQuote>
  if (typeof summary !== 'object' || summary === null) return false
  return (
    typeof totalPrice === 'number' &&
    typeof discount === 'number' &&
    typeof finalPrice === 'number' &&
    typeof summary.title === 'string' &&
    typeof summary.departureDate === 'string' &&
    typeof summary.duration === 'number' &&
    typeof summary.levelName === 'string' &&
    typeof summary.headcount === 'number' &&
    Array.isArray(summary.options) &&
    summary.options.every((option: unknown) => typeof (option as Partial<SelectedOption> | null)?.name === 'string')
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
