import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatWon } from '@/lib/format'
import type { TourLevel } from '@/lib/labels'
import type { LevelDetail, TourOptionItem, TourOptionsResponse } from '@/lib/tours'
import { ApiClient, showError } from '@/modules/ApiClient'

interface OptionPanelProps {
  tourId: number
  // 마지막으로 가격 계산에 보낸 투어 등급. 요금 차이가 이 등급 기준이다
  level: TourLevel
  levelDetail: LevelDetail | undefined
  optionIds: number[]
  // 지금 고른 옵션으로 나온 최종 가격. 아직 없으면 null
  price: number | null
  message: string | null
  disabled: boolean
  onChangeOptions(optionIds: number[]): void
  onFinish(): void
}

const DEFAULT_CHOICE = 'default'

function priceDiffLabel(priceDiff: number): string {
  if (priceDiff === 0) return '추가 요금 없음'
  return `1인 ${priceDiff > 0 ? '+' : '−'}${formatWon(Math.abs(priceDiff))}`
}

function OptionText({ option }: { option: TourOptionItem }) {
  return (
    <>
      {option.name}
      <span className="text-muted-foreground">{priceDiffLabel(option.priceDiff)}</span>
    </>
  )
}

interface SingleChoiceProps {
  title: string
  name: string
  defaultLabel: string
  items: TourOptionItem[]
  optionIds: number[]
  disabled: boolean
  onSelect(items: TourOptionItem[], choice: string): void
}

// 호텔·교통·식사는 종류마다 하나만 고른다. 고르지 않으면 그 등급의 기본 제공으로 계산된다
function SingleChoice({ title, name, defaultLabel, items, optionIds, disabled, onSelect }: SingleChoiceProps) {
  const chosen = items.find((item) => optionIds.includes(item.optionId))
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      <RadioGroup
        value={chosen ? String(chosen.optionId) : DEFAULT_CHOICE}
        onValueChange={(choice) => onSelect(items, choice)}
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${name}-default`} value={DEFAULT_CHOICE} />
          <Label htmlFor={`${name}-default`}>{defaultLabel}</Label>
        </div>
        {items.map((item) => (
          <div key={item.optionId} className="flex items-center gap-2">
            <RadioGroupItem id={`${name}-${item.optionId}`} value={String(item.optionId)} />
            <Label htmlFor={`${name}-${item.optionId}`}>
              <OptionText option={item} />
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

// 옵션 목록은 상품·투어 등급마다 불러온다(요금 차이가 등급 기준이다). 부르는 쪽이 상품·등급을 key로 주어,
// 등급이 바뀌면 새로 그린다. 고른 옵션과 가격은 TourSelectPage가 갖는다
export function OptionPanel(props: OptionPanelProps) {
  const { tourId, level, levelDetail, optionIds, price, message, disabled, onChangeOptions, onFinish } = props
  // undefined면 불러오는 중, null이면 불러오지 못했다
  const [options, setOptions] = useState<TourOptionsResponse | null | undefined>(undefined)
  // 불러오지 못했을 때 다시 불러오기를 누르면 올린다
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    ApiClient.get<TourOptionsResponse>(`/api/v1/tours/${tourId}/options?level=${level}`)
      .then((result) => {
        if (active) setOptions(result)
      })
      .catch((error: unknown) => {
        if (!active) return
        showError(error)
        setOptions(null)
      })
    return () => {
      active = false
    }
  }, [tourId, level, attempt])

  function retry() {
    setOptions(undefined)
    setAttempt((count) => count + 1)
  }

  function selectOption(items: TourOptionItem[], choice: string) {
    const others = optionIds.filter((id) => !items.some((item) => item.optionId === id))
    onChangeOptions(choice === DEFAULT_CHOICE ? others : [...others, Number(choice)])
  }

  function toggleExtra(optionId: number, checked: boolean) {
    const others = optionIds.filter((id) => id !== optionId)
    onChangeOptions(checked ? [...others, optionId] : others)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>옵션 바꾸기</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {options === undefined && <p className="text-sm text-muted-foreground">옵션을 불러오는 중입니다.</p>}
        {options === null && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">옵션을 불러오지 못했습니다.</p>
            <Button variant="outline" onClick={retry}>
              다시 불러오기
            </Button>
          </div>
        )}
        {options && (
          <>
            <SingleChoice
              title="호텔"
              name="hotel"
              defaultLabel={levelDetail ? `기본 제공(${levelDetail.hotelGrade}등급 호텔)` : '기본 제공'}
              items={options.hotels}
              optionIds={optionIds}
              disabled={disabled}
              onSelect={selectOption}
            />
            <SingleChoice
              title="교통"
              name="transport"
              defaultLabel="기본 제공"
              items={options.transports}
              optionIds={optionIds}
              disabled={disabled}
              onSelect={selectOption}
            />
            <SingleChoice
              title="식사"
              name="meal"
              defaultLabel={levelDetail ? `기본 제공(${levelDetail.meal})` : '기본 제공'}
              items={options.meals}
              optionIds={optionIds}
              disabled={disabled}
              onSelect={selectOption}
            />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">추가 옵션</legend>
              {levelDetail?.includesChampagne && (
                <p className="text-sm text-muted-foreground">{levelDetail.name} 등급은 샴페인이 기본으로 포함됩니다.</p>
              )}
              {options.extras.map((item) => (
                <div key={item.optionId} className="flex items-center gap-2">
                  <Checkbox
                    id={`extra-${item.optionId}`}
                    checked={optionIds.includes(item.optionId)}
                    onCheckedChange={(checked) => toggleExtra(item.optionId, checked === true)}
                    disabled={disabled}
                  />
                  <Label htmlFor={`extra-${item.optionId}`}>
                    <OptionText option={item} />
                  </Label>
                </div>
              ))}
            </fieldset>
          </>
        )}
        {message && (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-4">
        <p className="text-sm">
          {disabled
            ? '가격을 다시 계산하는 중입니다.'
            : price === null
              ? '투어 등급과 인원으로 가격을 다시 계산해 주세요.'
              : `최종 가격 ${formatWon(price)}`}
        </p>
        {/* 가격 계산 중에 닫으면 그 결과의 문구(닫힌 패널 안)를 못 본다 */}
        <Button variant="outline" onClick={onFinish} disabled={disabled}>
          옵션 고르기 끝
        </Button>
      </CardFooter>
    </Card>
  )
}
