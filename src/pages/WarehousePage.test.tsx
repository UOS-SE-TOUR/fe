import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATEWAY_TIMEOUT_MESSAGE, UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { routes } from '@/router/routes'
import { jsonResponse, stubFetch } from '@/test/http'

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

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/staff/items'] })
  render(<RouterProvider router={router} />)
  return router
}

function requestAt(index: number) {
  const [path, init] = fetchMock.mock.calls[index]
  return { path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

async function fillForm(name: string, themeLabel: string, quantity: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('물품 이름'), name)
  await user.selectOptions(screen.getByLabelText('테마'), themeLabel)
  await user.type(screen.getByLabelText('수량'), quantity)
  return user
}

function rowTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
}

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
    expect(screen.getByLabelText('물품 이름')).toHaveValue('')
    expect(screen.getByLabelText('수량')).toHaveValue('')
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

    await user.type(screen.getByLabelText('물품 이름'), '골프공')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(screen.getByRole('alert')).toHaveTextContent('테마를 골라 주세요.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('요청이 끝날 때까지 추가 단추를 막아 한 번만 보낸다', async () => {
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
    await user.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    respond(jsonResponse(200, { ...golfBall, quantity: 10 }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 10개)'))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
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
    expect(screen.getByLabelText('물품 이름')).toHaveValue('')
    expect(screen.getByLabelText('수량')).toHaveValue('')

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

  it('성공 응답인데 본문이 비었으면 처리됐는지 모르는 것으로 다룬다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '10')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '30개']]))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('물품 이름')).toHaveValue('')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})
