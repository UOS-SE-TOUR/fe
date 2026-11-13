import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATEWAY_TIMEOUT_MESSAGE, UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { routes } from '@/router/routes'
import { jsonResponse, stubFetch } from '@/test/http'
import { leaveBlocked, waitUntilLeaveAllowed } from '@/test/leave'

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

const golfBall = { id: 1, name: '골프공', theme: 'GOLF', quantity: 20 }
const tent = { id: 2, name: '텐트', theme: 'TREKKING', quantity: 3 }

// 직원 메뉴에서 들어온 것처럼 띄운다(뒤로 가기가 직원 메뉴로 간다)
function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/staff', '/staff/items'], initialIndex: 1 })
  render(<RouterProvider router={router} />)
  return router
}

function requestAt(index: number) {
  const [path, init] = fetchMock.mock.calls[index]
  return { path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

async function fillForm(name: string, themeLabel: string, quantity: string) {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '물품 이름' }), name)
  await user.selectOptions(screen.getByRole('combobox', { name: '테마' }), themeLabel)
  await user.type(screen.getByRole('textbox', { name: '수량' }), quantity)
  return user
}

function rowTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
}

it('직원 메뉴 링크로 직원 첫 화면에 돌아간다', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
  const router = renderPage()
  await screen.findByText('창고에 물품이 없습니다.')

  await userEvent.setup().click(screen.getByRole('link', { name: '직원 메뉴' }))

  expect(await screen.findByRole('heading', { name: '직원 메뉴' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/staff')
})

describe('물품 목록', () => {
  it('서버가 준 순서대로 이름·테마 화면 이름·수량을 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [tent, golfBall]))
    renderPage()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([
      ['텐트', '아웃도어 트레킹 투어', '3개'],
      ['골프공', '골프 챌린지 투어', '20개'],
    ])
    expect(requestAt(0)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
  })

  it('물품이 없으면 없다고 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()

    expect(await screen.findByText('창고에 물품이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('불러오지 못하면 문구를 알리고 다시 불러올 수 있다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: '서버에 문제가 생겼습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()

    expect(await screen.findByText('물품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('서버에 문제가 생겼습니다.')

    await userEvent.setup().click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '20개']])
  })

  it.each([
    ['빈 본문', new Response('', { status: 200 })],
    ['배열이 아닌 본문', jsonResponse(200, { message: '잘못된 응답' })],
  ])('성공 응답인데 %s이면 못 읽은 것으로 보여 준다', async (_, response) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(response)
    renderPage()

    expect(await screen.findByText('물품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('물품 추가', () => {
  it('보낸 수량과 현재 수량을 알리고 목록을 다시 불러온다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, quantity: 30 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 30개)'))
    expect(requestAt(1)).toEqual({
      path: '/api/v1/staff/items',
      method: 'POST',
      body: { itemName: '골프공', theme: 'GOLF', quantity: 10 },
    })
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '30개']]))
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('')
  })

  it('목록을 다시 읽기 전에도 표의 그 물품 수량을 바로 바꾼다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [tent, golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, quantity: 30 }))
      .mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() =>
      expect(rowTexts()).toEqual([
        ['텐트', '아웃도어 트레킹 투어', '3개'],
        ['골프공', '골프 챌린지 투어', '30개'],
      ]),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('있던 물품이면 처음 저장된 이름으로 알린다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, name: 'Golf Ball' }]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, name: 'Golf Ball', quantity: 25 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, name: 'Golf Ball', quantity: 25 }]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('golf ball', '골프 챌린지 투어', '5')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Golf Ball 5개를 더했습니다(지금 25개)'))
  })

  it('400이면 서버 문구를 보여 주고 다시 추가할 수 있다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(400, { message: '물품 이름은 100자 이하로 입력해 주세요.' }))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('긴 이름', '골프 챌린지 투어', '1')
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('물품 이름은 100자 이하로 입력해 주세요.')
    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await waitUntilLeaveAllowed()
  })

  it.each([
    ['1.5', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['0', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['-3', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['2147483648', '창고에 둘 수 있는 수량을 넘습니다.'],
  ])('수량 %s는 보내지 않고 막는다', async (quantity, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('골프공', '골프 챌린지 투어', quantity)
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('이름이나 테마가 비었으면 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(screen.getByRole('alert')).toHaveTextContent('물품 이름을 입력해 주세요.')

    await user.type(screen.getByRole('textbox', { name: '물품 이름' }), '골프공')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(screen.getByRole('alert')).toHaveTextContent('테마를 골라 주세요.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('요청이 끝날 때까지 추가 단추와 입력칸을 막아 한 번만 보낸다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 10 }]))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))
    const button = screen.getByRole('button', { name: '추가하는 중' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '테마' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '수량' })).toBeDisabled()
    await user.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    respond(jsonResponse(200, { ...golfBall, quantity: 10 }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 10개)'))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('추가하는 동안은 직원 메뉴 링크와 뒤로 가기 같은 화면 이동, 탭 닫기를 막고, 응답을 받으면 풀어 준다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 10 }]))
    const router = renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(screen.queryByRole('link', { name: '직원 메뉴' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '직원 메뉴' })).toBeDisabled()

    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/staff/items')
    expect(info).toHaveBeenCalledWith('추가가 끝날 때까지 이 화면에 있어 주세요.', expect.anything())
    expect(leaveBlocked()).toBe(true)

    respond(jsonResponse(200, { ...golfBall, quantity: 10 }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 10개)'))
    expect(screen.getByRole('link', { name: '직원 메뉴' })).toBeInTheDocument()
    await waitUntilLeaveAllowed()
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/staff')
  })

  it('추가하는 중에 401이 오면 로그인 화면으로 간다(이동을 막지 않는다)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    const router = renderPage()
    await screen.findByText('창고에 물품이 없습니다.')
    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(info).not.toHaveBeenCalled()
    await waitUntilLeaveAllowed()
  })

  it('처리됐는지 모르면 다시 보내지 않고, 입력을 비우고, 목록을 다시 불러온 뒤에 단추를 연다', async () => {
    let respondList: (response: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(504, {}))
      .mockReturnValueOnce(new Promise((resolve) => (respondList = resolve)))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GATEWAY_TIMEOUT_MESSAGE))
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled()
    expect(screen.getByText('물품 목록을 다시 불러온 뒤에 추가할 수 있습니다.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('물품 목록을 불러오는 중입니다.')).toBeInTheDocument()
    // 추가 요청은 끝났으니 목록을 다시 읽는 동안에는 떠날 수 있다
    await waitUntilLeaveAllowed()

    respondList(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '30개']]))
    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('처리됐는지 모르고 목록도 못 읽으면 다시 불러올 때까지 단추를 막는다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('물품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE)
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '30개']]))
    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled()
  })

  it.each([
    ['비었으면', () => new Response('', { status: 200 })],
    ['물품이 아니면', () => jsonResponse(200, { result: 'ok' })],
  ])('성공 응답인데 본문이 %s 처리됐는지 모르는 것으로 다룬다', async (_, response) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '30개']]))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})
