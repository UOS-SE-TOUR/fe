import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATEWAY_TIMEOUT_MESSAGE, UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  AuthStore.setMember('STAFF', '김직원')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

async function openPage() {
  const router = renderAt('/staff/tours/new')
  expect(await screen.findByRole('heading', { name: '상품 기획' })).toBeInTheDocument()
  return { user: userEvent.setup(), router }
}

type User = ReturnType<typeof userEvent.setup>

async function fillGolfTour(user: User) {
  await user.click(screen.getByRole('radio', { name: '골프 챌린지 투어' }))
  await user.type(screen.getByLabelText('출발일'), '2027-03-15')
  await user.type(screen.getByLabelText('기간(일)'), '5')
  await user.type(screen.getByLabelText('정원(명)'), '20')
  await user.type(screen.getByLabelText('클래식'), '1000000')
  await user.type(screen.getByLabelText('그랜드'), '1500000')
  await user.type(screen.getByLabelText('프리미엄'), '2000000')
  await user.type(screen.getByLabelText('교통 1 이름'), '전세 버스')
  await user.type(screen.getByLabelText('교통 1 1인 추가 요금(원)'), '0')
}

function sentBody(): unknown {
  return sentRequest(fetchMock).body
}

const golfRequest = {
  theme: 'GOLF',
  departureDate: '2027-03-15',
  duration: 5,
  capacity: 20,
  prices: [
    { level: 'CLASSIC', price: 1000000 },
    { level: 'GRAND', price: 1500000 },
    { level: 'PREMIUM', price: 2000000 },
  ],
  transports: [{ name: '전세 버스', unitPrice: 0 }],
}

describe('등록', () => {
  it('입력한 상품을 등록하고 상품 번호를 보여 준다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 12 }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품 번호 12')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentRequest(fetchMock)).toEqual({ path: '/api/v1/staff/tours', method: 'POST', body: golfRequest })
  })

  it('다른 상품 기획하기를 누르면 빈 입력 화면으로 돌아간다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 12 }))
    await user.click(screen.getByRole('button', { name: '등록' }))

    await user.click(await screen.findByRole('button', { name: '다른 상품 기획하기' }))

    expect(screen.getByRole('radio', { name: '골프 챌린지 투어' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '허니문 낭만 투어' })).toHaveFocus()
    expect(screen.getByLabelText('기간(일)')).toHaveValue('')
    expect(screen.getByLabelText('교통 1 이름')).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('요청이 끝날 때까지 등록 단추를 막고, 여러 번 눌러도 한 번만 보낸다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))

    const button = screen.getByRole('button', { name: '등록' })
    await user.dblClick(button)

    expect(screen.getByRole('button', { name: '등록하는 중…' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    respond(jsonResponse(201, { tourId: 12 }))
    expect(await screen.findByText('상품 번호 12')).toBeInTheDocument()
  })

  it('보내는 동안에는 입력을 막는다(고친 값이 등록되지 않으니)', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByLabelText('정원(명)')).toBeDisabled()
    expect(screen.getByRole('radio', { name: '허니문 낭만 투어' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '교통 선택지 더하기' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: '직원 첫 화면으로' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '직원 첫 화면으로' })).toBeDisabled()

    respond(jsonResponse(400, { message: '정원은 3명 이상이어야 합니다.' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('정원은 3명 이상이어야 합니다.')
    expect(screen.getByLabelText('정원(명)')).toBeEnabled()
    expect(screen.getByRole('link', { name: '직원 첫 화면으로' })).toBeInTheDocument()
  })

  it('보내는 동안에는 화면 이동과 탭 닫기를 막고, 끝나면 풀어 준다', async () => {
    const { user, router } = await openPage()
    await fillGolfTour(user)
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
    await user.click(screen.getByRole('button', { name: '등록' }))

    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
    await act(() => router.navigate('/staff'))
    expect(router.state.location.pathname).toBe('/staff/tours/new')
    expect(info).toHaveBeenCalledWith('등록이 끝날 때까지 이 화면에 있어 주세요.', expect.anything())
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)

    respond(jsonResponse(201, { tourId: 12 }))
    expect(await screen.findByText('상품 번호 12')).toBeInTheDocument()
    const leavingAfter = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leavingAfter)
    expect(leavingAfter.defaultPrevented).toBe(false)
    await act(() => router.navigate('/staff'))
    expect(router.state.location.pathname).toBe('/staff')
  })

  it('보내는 중에 401이 오면 로그인 화면으로 간다(이동을 막지 않는다)', async () => {
    const { user, router } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: '로그인이 필요합니다.' }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('등록하면 다음 단추(다른 상품 기획하기)로 초점을 옮긴다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 12 }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    const next = await screen.findByRole('button', { name: '다른 상품 기획하기' })
    expect(next).toHaveFocus()
    expect(next).toHaveAccessibleDescription('상품을 등록했습니다 상품 번호 12')
  })

  it('상품 번호가 없는 성공 응답이면 등록했다고 보여 주되 상품 번호를 받지 못했다고 알린다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품을 등록했습니다')).toBeInTheDocument()
    expect(screen.getByText('상품 번호를 받지 못했습니다.')).toBeInTheDocument()
  })

  it('허니문·효도 테마는 클래식 칸을 숨기고, 숨긴 칸의 값은 보내지 않는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.click(screen.getByRole('radio', { name: '허니문 낭만 투어' }))

    expect(screen.queryByLabelText('클래식')).not.toBeInTheDocument()
    expect(screen.getByText('허니문 낭만 투어는 그랜드와 프리미엄 가격만 받습니다.')).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 13 }))
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품 번호 13')).toBeInTheDocument()
    expect(sentBody()).toEqual({
      ...golfRequest,
      theme: 'HONEYMOON',
      prices: [
        { level: 'GRAND', price: 1500000 },
        { level: 'PREMIUM', price: 2000000 },
      ],
    })
  })

  it('교통 선택지 줄을 더하고 뺄 수 있다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    expect(screen.getByRole('button', { name: '교통 1 빼기' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '교통 선택지 더하기' }))
    await user.type(screen.getByLabelText('교통 2 이름'), 'KTX')
    await user.type(screen.getByLabelText('교통 2 1인 추가 요금(원)'), '30000')
    await user.click(screen.getByRole('button', { name: '교통 선택지 더하기' }))
    await user.type(screen.getByLabelText('교통 3 이름'), '항공')
    await user.type(screen.getByLabelText('교통 3 1인 추가 요금(원)'), '150000')
    await user.click(screen.getByRole('button', { name: '교통 2 빼기' }))

    expect(screen.getByLabelText('교통 2 이름')).toHaveValue('항공')
    expect(screen.queryByLabelText('교통 3 이름')).not.toBeInTheDocument()
    // 누른 빼기 단추가 사라졌으니 초점은 더하기 단추로
    expect(screen.getByRole('button', { name: '교통 선택지 더하기' })).toHaveFocus()

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 14 }))
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품 번호 14')).toBeInTheDocument()
    expect(sentBody()).toEqual({
      ...golfRequest,
      transports: [
        { name: '전세 버스', unitPrice: 0 },
        { name: '항공', unitPrice: 150000 },
      ],
    })
  })
})

describe('화면에서 막는 것', () => {
  it('빈 칸이 있으면 보내지 않고 칸마다 알린다', async () => {
    const { user } = await openPage()

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByText('테마를 골라 주세요.')).toBeInTheDocument()
    expect(screen.getByText('출발일을 연·월·일까지 맞게 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('기간을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('정원을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('교통 이름을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('추가 요금을 입력해 주세요.')).toBeInTheDocument()
    // 칸마다 막은 이유는 알림으로 낭독하지 않는다(초점이 옮겨 간 칸과 함께 읽힌다)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)

    expect(screen.getByRole('radio', { name: '허니문 낭만 투어' })).toHaveFocus()

    await user.click(screen.getByRole('radio', { name: '효도 힐링 투어' }))
    expect(screen.queryByText('테마를 골라 주세요.')).not.toBeInTheDocument()
    expect(screen.getByText('그랜드 가격을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('프리미엄 가격을 입력해 주세요.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('정수가 아닌 값(소수 포함)이 있으면 보내지 않는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('기간(일)'))
    await user.type(screen.getByLabelText('기간(일)'), '2.5')
    await user.clear(screen.getByLabelText('그랜드'))
    await user.type(screen.getByLabelText('그랜드'), '150만')
    await user.clear(screen.getByLabelText('교통 1 1인 추가 요금(원)'))
    await user.type(screen.getByLabelText('교통 1 1인 추가 요금(원)'), '0.0')
    // 초점이 옮겨지는 그 순간에 막은 이유가 이미 칸에 이어져 있어야 낭독기가 함께 읽는다
    const duration = screen.getByLabelText('기간(일)')
    let describedAtFocus: string | null = null
    duration.addEventListener('focus', () => (describedAtFocus = duration.getAttribute('aria-describedby')))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByText('기간은 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('그랜드 가격은 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('추가 요금은 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByLabelText('기간(일)')).toHaveFocus()
    expect(screen.getByLabelText('기간(일)')).toHaveAccessibleDescription('기간은 정수로 입력해 주세요.')
    expect(describedAtFocus).toBe('duration-error')
    expect(fetchMock).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('기간(일)'))
    await user.type(screen.getByLabelText('기간(일)'), '3')
    expect(screen.queryByText('기간은 정수로 입력해 주세요.')).not.toBeInTheDocument()
  })

  it('막은 칸은 그 이유 문구로 이어 읽힌다', async () => {
    const { user } = await openPage()
    expect(screen.getByLabelText('정원(명)')).toHaveAccessibleDescription('3명 이상, 허니문 낭만 투어는 짝수')

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByLabelText('기간(일)')).toHaveAccessibleDescription('기간을 입력해 주세요.')
    expect(screen.getByLabelText('교통 1 이름')).toHaveAccessibleDescription('교통 이름을 입력해 주세요.')
    expect(screen.getByLabelText('정원(명)')).toHaveAccessibleDescription(
      '3명 이상, 허니문 낭만 투어는 짝수 정원을 입력해 주세요.',
    )
    await user.type(screen.getByLabelText('기간(일)'), '3')
    expect(screen.getByLabelText('기간(일)')).not.toHaveAttribute('aria-describedby')
  })

  it('세 자리마다 쉼표를 찍은 수와 전각 숫자는 정수로 받고, 교통 이름은 앞뒤 공백을 떼어 보낸다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('그랜드'))
    await user.type(screen.getByLabelText('그랜드'), '1,500,000')
    await user.clear(screen.getByLabelText('정원(명)'))
    await user.type(screen.getByLabelText('정원(명)'), '２０')
    await user.clear(screen.getByLabelText('교통 1 이름'))
    await user.type(screen.getByLabelText('교통 1 이름'), '  전세 버스 ')
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 16 }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품 번호 16')).toBeInTheDocument()
    expect(sentBody()).toEqual(golfRequest)
  })

  it('쉼표 자리가 틀린 수는 정수로 받지 않는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('그랜드'))
    await user.type(screen.getByLabelText('그랜드'), '15,0000')

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByText('그랜드 가격은 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('be가 int로 읽을 수 있는 가장 작은 수까지는 서버에 보낸다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('기간(일)'))
    await user.type(screen.getByLabelText('기간(일)'), '-2147483649')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByText('기간은 입력할 수 있는 범위를 넘었습니다.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('기간(일)'))
    await user.type(screen.getByLabelText('기간(일)'), '-2147483648')
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: '기간은 1일 이상이어야 합니다.' }))
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('기간은 1일 이상이어야 합니다.')
    expect(sentBody()).toEqual({ ...golfRequest, duration: -2147483648 })
  })

  it('서버가 정수로 읽지 못하는 큰 수는 보내지 않는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('정원(명)'))
    await user.type(screen.getByLabelText('정원(명)'), '3000000000')

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByText('정원은 입력할 수 있는 범위를 넘었습니다.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('서버에 맡기는 것', () => {
  it('서버가 거부하면 그 문구를 보여 주고 고쳐서 다시 등록할 수 있다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    await user.clear(screen.getByLabelText('교통 1 1인 추가 요금(원)'))
    await user.type(screen.getByLabelText('교통 1 1인 추가 요금(원)'), '10000')
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: '추가 요금이 0원인 기본 교통을 넣어 주세요.' }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('추가 요금이 0원인 기본 교통을 넣어 주세요.')
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()

    await user.clear(screen.getByLabelText('교통 1 1인 추가 요금(원)'))
    await user.type(screen.getByLabelText('교통 1 1인 추가 요금(원)'), '0')
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { tourId: 15 }))
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('상품 번호 15')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('지난 서버 문구는 입력을 고치거나 다시 등록을 누르면 지운다', async () => {
    const serverMessage = '정원은 3명 이상이어야 합니다.'
    const { user } = await openPage()
    await fillGolfTour(user)
    // Response 본문은 한 번만 읽히니 부를 때마다 새로 만든다
    fetchMock.mockImplementation(async () => jsonResponse(400, { message: serverMessage }))
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText(serverMessage)).toBeInTheDocument()

    await user.type(screen.getByLabelText('정원(명)'), '0')
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText(serverMessage)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('기간(일)'))
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()
    expect(screen.getByText('기간을 입력해 주세요.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('처리됐는지 모르는 실패', () => {
  it.each([
    ['500', () => jsonResponse(500, { message: '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' }), UNKNOWN_RESULT_MESSAGE],
    ['504', () => new Response('', { status: 504 }), GATEWAY_TIMEOUT_MESSAGE],
    // be가 보낸 응답인지 알 수 없다(로그인 포털 등)
    ['본문을 읽지 못한 성공 응답', () => new Response('<html>', { status: 200 }), UNKNOWN_RESULT_MESSAGE],
    ['본문이 빈 성공 응답', () => new Response('', { status: 201 }), UNKNOWN_RESULT_MESSAGE],
  ])('%s면 문구를 보여 주고 등록 단추를 다시 열지 않는다', async (_, response, message) => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockResolvedValueOnce(response())

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText(/확인할 수 없어 등록 단추를 막았습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
    // 눌렀던 단추가 계속 막혀 있으니 초점은 막은 까닭을 적은 안내로 옮긴다
    expect(screen.getByText(/확인할 수 없어 등록 단추를 막았습니다/)).toHaveFocus()

    await user.type(screen.getByLabelText('기간(일)'), '0')
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
  })

  it('마우스로 눌러 단추에 초점이 없었어도(Safari 등) 끝난 뒤 초점을 둘 곳을 찾는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { message: '정원은 3명 이상이어야 합니다.' }))
      .mockResolvedValueOnce(jsonResponse(500, {}))
    const button = screen.getByRole('button', { name: '등록' })
    act(() => (document.activeElement as HTMLElement | null)?.blur())

    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('정원은 3명 이상이어야 합니다.')
    expect(button).toHaveFocus()

    act(() => button.blur())
    fireEvent.click(button)
    expect(await screen.findByText(/확인할 수 없어 등록 단추를 막았습니다/)).toHaveFocus()
  })

  it('연결이 끊기면 처리됐는지 모른다고 알리고 단추를 다시 열지 않는다', async () => {
    const { user } = await openPage()
    await fillGolfTour(user)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(UNKNOWN_RESULT_MESSAGE)
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
  })
})

describe('권한 실패', () => {
  it('403이면 ApiClient가 알리고, 화면에는 문구를 더하지 않으며 단추를 다시 연다', async () => {
    const { user, router } = await openPage()
    await fillGolfTour(user)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: '직원만 할 수 있습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, { memberType: 'STAFF', name: '김직원' }))

    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('button', { name: '등록' })).toBeEnabled()
    expect(toast.error).toHaveBeenCalledWith('직원만 할 수 있습니다.', expect.anything())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff/tours/new')
  })
})
