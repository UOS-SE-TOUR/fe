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

const golfBall = { id: 1, name: '골프공', theme: 'GOLF', perPerson: 2, quantity: 20 }
const tent = { id: 2, name: '텐트', theme: 'TREKKING', perPerson: 1, quantity: 3 }

const PER_PERSON_RANGE_MESSAGE = '1인당 개수는 0부터 100까지의 정수로 입력해 주세요.'

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

function postCount() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length
}

function getCount() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length
}

async function fillForm(name: string, themeLabel: string, perPerson: string, quantity: string) {
  const user = userEvent.setup()
  if (name) await user.type(screen.getByRole('textbox', { name: '물품 이름' }), name)
  if (themeLabel) await user.selectOptions(screen.getByRole('combobox', { name: '테마' }), themeLabel)
  if (perPerson) await user.type(screen.getByRole('textbox', { name: '1인당 개수' }), perPerson)
  if (quantity) await user.type(screen.getByRole('textbox', { name: '처음 수량' }), quantity)
  return user
}

// 이름·테마·1인당 개수·수량 칸(단추 칸은 뺀다)
function rowTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 4)
        .map((cell) => cell.textContent),
    )
}

function rowOf(name: string) {
  const row = screen.getAllByRole('row').find((item) => within(item).queryByRole('cell', { name }))
  if (!row) throw new Error(`${name} 줄이 없다`)
  return row
}

// 그 물품 줄의 단추로 작은 창을 열고, 입력칸을 비운 뒤 value를 넣는다
async function openDialog(itemName: string, buttonName: '수량 더하기' | '1인당 개수 바꾸기', value: string) {
  const user = userEvent.setup()
  await user.click(within(rowOf(itemName)).getByRole('button', { name: buttonName }))
  const dialog = await screen.findByRole('dialog', { name: buttonName })
  const input = within(dialog).getByRole('textbox')
  await user.clear(input)
  if (value) await user.type(input, value)
  return { user, dialog }
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
  it('서버가 준 순서대로 이름·테마 화면 이름·1인당 개수·수량을 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [tent, { ...golfBall, perPerson: 0 }]))
    renderPage()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([
      ['텐트', '아웃도어 트레킹 투어', '1개', '3개'],
      ['골프공', '골프 챌린지 투어', '0개', '20개'],
    ])
    expect(requestAt(0)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
  })

  it('수량이 음수면 모자란 개수를 경고 색으로 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ ...tent, quantity: -3 }, golfBall]))
    renderPage()
    await screen.findByRole('table')

    expect(rowTexts()).toEqual([
      ['텐트', '아웃도어 트레킹 투어', '1개', '부족 3개'],
      ['골프공', '골프 챌린지 투어', '2개', '20개'],
    ])
    expect(screen.getByText('부족 3개')).toHaveClass('text-destructive')
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
    expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '2개', '20개']])
  })

  it.each([
    ['빈 본문', () => new Response('', { status: 200 })],
    ['배열이 아닌 본문', () => jsonResponse(200, { message: '잘못된 응답' })],
    ['1인당 개수가 없는 물품', () => jsonResponse(200, [{ id: 1, name: '골프공', theme: 'GOLF', quantity: 20 }])],
  ])('성공 응답인데 %s이면 못 읽은 것으로 보여 준다', async (_, response) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(response())
    renderPage()

    expect(await screen.findByText('물품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('새 물품 등록', () => {
  it('맞는 주소와 본문으로 보내고, 결과를 알리고, 입력을 비우고, 목록을 다시 불러온다', async () => {
    const shoes = { id: 3, name: '등산화', theme: 'TREKKING', perPerson: 0, quantity: 10 }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, shoes))
      .mockResolvedValueOnce(jsonResponse(200, [golfBall, shoes]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '0', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('등산화 10개를 등록했습니다'))
    expect(requestAt(1)).toEqual({
      path: '/api/v1/staff/items',
      method: 'POST',
      body: { itemName: '등산화', theme: 'TREKKING', perPerson: 0, quantity: 10 },
    })
    await waitFor(() =>
      expect(rowTexts()).toEqual([
        ['골프공', '골프 챌린지 투어', '2개', '20개'],
        ['등산화', '아웃도어 트레킹 투어', '0개', '10개'],
      ]),
    )
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '1인당 개수' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '처음 수량' })).toHaveValue('')
  })

  it('1인당 개수 칸에 무엇을 넣는지 설명한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    expect(screen.getByRole('textbox', { name: '1인당 개수' })).toHaveAccessibleDescription(
      '고객 한 명에게 주는 개수입니다. 주지 않으면 0을 넣습니다.',
    )
  })

  it('같은 물품이 이미 있으면 서버 문구를 보여 주고 입력을 그대로 둔다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(400, { message: '이미 있는 물품입니다. 목록에서 수량을 더해 주세요.' }))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('골프공', '골프 챌린지 투어', '2', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 있는 물품입니다. 목록에서 수량을 더해 주세요.')
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('골프공')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await waitUntilLeaveAllowed()
  })

  it.each([
    ['', '10', '1인당 개수를 입력해 주세요.'],
    ['-1', '10', PER_PERSON_RANGE_MESSAGE],
    ['101', '10', PER_PERSON_RANGE_MESSAGE],
    ['1.5', '10', PER_PERSON_RANGE_MESSAGE],
    ['1', '', '수량을 입력해 주세요.'],
    ['1', '0', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['1', '1.5', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['1', '-3', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['1', '2147483648', '창고에 둘 수 있는 수량을 넘습니다.'],
  ])('1인당 개수 "%s"·수량 "%s"는 보내지 않고 막는다', async (perPerson, quantity, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('골프공', '골프 챌린지 투어', perPerson, quantity)
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('이름이나 테마가 비었으면 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByText('창고에 물품이 없습니다.')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('물품 이름을 입력해 주세요.')

    await user.type(screen.getByRole('textbox', { name: '물품 이름' }), '골프공')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('테마를 골라 주세요.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('요청이 끝날 때까지 등록 단추·입력칸·물품 단추를 막아 한 번만 보낸다', async () => {
    let respond: (response: Response) => void = () => {}
    const shoes = { id: 3, name: '등산화', theme: 'TREKKING', perPerson: 1, quantity: 10 }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(jsonResponse(200, [golfBall, shoes]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))
    const button = screen.getByRole('button', { name: '등록하는 중' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '테마' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '1인당 개수' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '처음 수량' })).toBeDisabled()
    expect(within(rowOf('골프공')).getByRole('button', { name: '수량 더하기' })).toBeDisabled()
    expect(within(rowOf('골프공')).getByRole('button', { name: '1인당 개수 바꾸기' })).toBeDisabled()
    await user.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    respond(jsonResponse(200, shoes))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('등산화 10개를 등록했습니다'))
    expect(postCount()).toBe(1)
  })

  it('등록하는 동안은 직원 메뉴 링크와 뒤로 가기 같은 화면 이동, 탭 닫기를 막고, 응답을 받으면 풀어 준다', async () => {
    let respond: (response: Response) => void = () => {}
    const shoes = { id: 3, name: '등산화', theme: 'TREKKING', perPerson: 1, quantity: 10 }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(jsonResponse(200, [shoes]))
    const router = renderPage()
    await screen.findByText('창고에 물품이 없습니다.')

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.queryByRole('link', { name: '직원 메뉴' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '직원 메뉴' })).toBeDisabled()

    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/staff/items')
    expect(info).toHaveBeenCalledWith('처리가 끝날 때까지 이 화면에 있어 주세요.', expect.anything())
    expect(leaveBlocked()).toBe(true)

    respond(jsonResponse(200, shoes))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('등산화 10개를 등록했습니다'))
    expect(screen.getByRole('link', { name: '직원 메뉴' })).toBeInTheDocument()
    await waitUntilLeaveAllowed()
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/staff')
  })

  it('등록하는 중에 401이 오면 로그인 화면으로 간다(이동을 막지 않는다)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(401, { message: '로그인이 필요합니다.' }))
    const router = renderPage()
    await screen.findByText('창고에 물품이 없습니다.')
    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')

    const user = await fillForm('골프공', '골프 챌린지 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

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

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GATEWAY_TIMEOUT_MESSAGE))
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
    expect(screen.getByText('물품 목록을 다시 불러온 뒤에 등록하거나 고칠 수 있습니다.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '1인당 개수' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: '처음 수량' })).toHaveValue('')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('물품 목록을 불러오는 중입니다.')).toBeInTheDocument()
    // 등록 요청은 끝났으니 목록을 다시 읽는 동안에는 떠날 수 있다
    await waitUntilLeaveAllowed()

    const shoes = { id: 3, name: '등산화', theme: 'TREKKING', perPerson: 1, quantity: 10 }
    respondList(jsonResponse(200, [golfBall, shoes]))
    await waitFor(() =>
      expect(rowTexts()).toEqual([
        ['골프공', '골프 챌린지 투어', '2개', '20개'],
        ['등산화', '아웃도어 트레킹 투어', '1개', '10개'],
      ]),
    )
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
    expect(within(rowOf('골프공')).getByRole('button', { name: '수량 더하기' })).toBeEnabled()
    expect(postCount()).toBe(1)
  })

  it('처리됐는지 모르고 목록도 못 읽으면 다시 불러올 때까지 단추를 막는다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('물품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE)
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '2개', '20개']]))
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
  })

  it.each([
    ['비었으면', () => new Response('', { status: 200 })],
    ['물품이 아니면', () => jsonResponse(200, { result: 'ok' })],
  ])('성공 응답인데 본문이 %s 처리됐는지 모르는 것으로 다룬다', async (_, response) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()
    await screen.findByRole('table')

    const user = await fillForm('등산화', '아웃도어 트레킹 투어', '1', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '2개', '20개']]))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('')
    expect(postCount()).toBe(1)
  })
})

describe('수량 더하기', () => {
  it('창에서 확인하면 그 물품 주소로 보내고, 창을 닫고, 결과를 알리고, 표를 바로 바꾼 뒤 목록을 다시 불러온다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [tent, golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, quantity: 30 }))
      .mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    expect(within(dialog).getByRole('textbox', { name: '더할 수량' })).toHaveValue('10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestAt(1)).toEqual({ path: '/api/v1/staff/items/1/quantity', method: 'POST', body: { quantity: 10 } })
    expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 30개)')
    expect(rowTexts()).toEqual([
      ['텐트', '아웃도어 트레킹 투어', '1개', '3개'],
      ['골프공', '골프 챌린지 투어', '2개', '30개'],
    ])
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
  })

  it('더해도 모자라면 아직 모자란 개수를 알린다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [{ ...tent, quantity: -5 }]))
      .mockResolvedValueOnce(jsonResponse(200, { ...tent, quantity: -2 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...tent, quantity: -2 }]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('텐트', '수량 더하기', '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('텐트 3개를 더했습니다(아직 2개 부족)'))
    expect(rowTexts()).toEqual([['텐트', '아웃도어 트레킹 투어', '1개', '부족 2개']])
  })

  it.each([
    [400, '창고에 둘 수 있는 수량을 넘습니다.', 1],
    [404, '창고 물품을 찾을 수 없습니다.', 2],
  ])('%i이면 서버 문구를 창 안에 보여 주고 창을 열어 둔다(404면 목록도 다시 읽는다)', async (status, message, gets) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(status, { message }))
      .mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('dialog', { name: '수량 더하기' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '확인' })).toBeEnabled()
    await waitFor(() => expect(getCount()).toBe(gets))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('수량을 더해도 새 물품 등록 칸의 오류 문구는 그대로 둔다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(400, { message: '이미 있는 물품입니다. 목록에서 수량을 더해 주세요.' }))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, quantity: 30 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')
    const user = await fillForm('골프공', '골프 챌린지 투어', '2', '10')
    await user.click(screen.getByRole('button', { name: '등록' }))
    await screen.findByRole('alert')

    const { dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공 10개를 더했습니다(지금 30개)'))
    expect(screen.getByRole('alert')).toHaveTextContent('이미 있는 물품입니다. 목록에서 수량을 더해 주세요.')
  })

  it('그 밖의 실패는 공용 알림으로 알리고 창을 열어 둔다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'),
    )
    expect(screen.getByRole('dialog', { name: '수량 더하기' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '확인' })).toBeEnabled()
  })

  it.each([
    ['', '수량을 입력해 주세요.'],
    ['0', '수량은 1 이상의 정수로 입력해 주세요.'],
    ['2.5', '수량은 1 이상의 정수로 입력해 주세요.'],
  ])('더할 수량 "%s"는 보내지 않고 창 안에 알린다', async (value, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', value)
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('보내는 동안 창을 닫을 수 없고 화면을 떠날 수 없다', async () => {
    let respond: (response: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(within(dialog).getByRole('button', { name: '처리하는 중' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '취소' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '수량 더하기' })).toBeInTheDocument()
    expect(leaveBlocked()).toBe(true)

    respond(jsonResponse(200, { ...golfBall, quantity: 30 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitUntilLeaveAllowed()
    expect(postCount()).toBe(1)
  })

  it('처리됐는지 모르면 창을 닫고, 목록을 다시 불러오기 전까지 단추를 막고, 등록 입력은 그대로 둔다', async () => {
    let respondList: (response: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockReturnValueOnce(new Promise((resolve) => (respondList = resolve)))
    renderPage()
    await screen.findByRole('table')
    await fillForm('등산화', '', '', '')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' })
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
    expect(screen.getByText('물품 목록을 다시 불러온 뒤에 등록하거나 고칠 수 있습니다.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '물품 이름' })).toHaveValue('등산화')

    respondList(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '2개', '30개']]))
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
    expect(within(rowOf('골프공')).getByRole('button', { name: '수량 더하기' })).toBeEnabled()
    expect(postCount()).toBe(1)
  })

  it('성공 응답인데 본문이 물품이 아니면 처리됐는지 모르는 것으로 다룬다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { result: 'ok' }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, quantity: 30 }]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '수량 더하기', '10')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '2개', '30개']]))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('1인당 개수 바꾸기', () => {
  it('지금 값을 채워 창을 열고, 확인하면 그 물품 주소로 보내고, 결과를 알리고 표를 바꾼다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, perPerson: 3 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, perPerson: 3 }]))
    renderPage()
    await screen.findByRole('table')
    const user = userEvent.setup()

    await user.click(within(rowOf('골프공')).getByRole('button', { name: '1인당 개수 바꾸기' }))
    const dialog = await screen.findByRole('dialog', { name: '1인당 개수 바꾸기' })
    const input = within(dialog).getByRole('textbox', { name: '1인당 개수' })
    expect(input).toHaveValue('2')
    expect(input).toHaveAccessibleDescription('고객 한 명에게 주는 개수입니다. 주지 않으면 0을 넣습니다.')

    await user.clear(input)
    await user.type(input, '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requestAt(1)).toEqual({ path: '/api/v1/staff/items/1/per-person', method: 'POST', body: { perPerson: 3 } })
    expect(screen.getByRole('status')).toHaveTextContent('골프공의 1인당 개수를 3개로 바꿨습니다')
    expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '3개', '20개']])
    await waitFor(() => expect(requestAt(2)).toMatchObject({ path: '/api/v1/staff/items', method: 'GET' }))
  })

  it.each([
    ['', '1인당 개수를 입력해 주세요.'],
    ['-1', PER_PERSON_RANGE_MESSAGE],
    ['101', PER_PERSON_RANGE_MESSAGE],
    ['1.5', PER_PERSON_RANGE_MESSAGE],
  ])('"%s"는 보내지 않고 창 안에 알린다', async (value, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', value)
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('0이면 보낸다(고객에게 주지 않는 물품)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(200, { ...golfBall, perPerson: 0 }))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, perPerson: 0 }]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '0')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('골프공의 1인당 개수를 0개로 바꿨습니다'))
    expect(requestAt(1).body).toEqual({ perPerson: 0 })
  })

  it.each([
    [400, '1인당 개수는 0개부터 100개까지입니다.', 1],
    [404, '창고 물품을 찾을 수 없습니다.', 2],
  ])('%i이면 서버 문구를 창 안에 보여 주고 창을 열어 둔다(404면 목록도 다시 읽는다)', async (status, message, gets) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(status, { message }))
      .mockResolvedValueOnce(jsonResponse(200, []))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('dialog', { name: '1인당 개수 바꾸기' })).toBeInTheDocument()
    await waitFor(() => expect(getCount()).toBe(gets))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('그 밖의 실패는 공용 알림으로 알리고, 창을 열어 둔 채 표를 서버 값에 맞춘다(다시 보내도 결과가 같다)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockResolvedValueOnce(jsonResponse(504, {}))
      .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, perPerson: 3 }]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GATEWAY_TIMEOUT_MESSAGE))
    expect(screen.getByRole('dialog', { name: '1인당 개수 바꾸기' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '확인' })).toBeEnabled()
    await waitFor(() => expect(getCount()).toBe(2))
    expect(screen.queryByText('물품 목록을 다시 불러온 뒤에 등록하거나 고칠 수 있습니다.')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '3개', '20개']]))
  })

  it('응답 없이 끊겼으면 한 번만 알리고 목록은 다시 읽지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'),
    )
    expect(screen.getByRole('dialog', { name: '1인당 개수 바꾸기' })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(getCount()).toBe(1)
  })

  it.each([
    ['비었으면', () => new Response('', { status: 200 })],
    ['물품이 아니면', () => jsonResponse(200, { result: 'ok' })],
  ])(
    '성공 응답인데 본문이 %s 처리됐는지 모른다고 알리고, 창을 열어 둔 채 목록을 다시 불러온다',
    async (_, response) => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, [golfBall]))
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(jsonResponse(200, [{ ...golfBall, perPerson: 3 }]))
      renderPage()
      await screen.findByRole('table')

      const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
      await user.click(within(dialog).getByRole('button', { name: '확인' }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
      expect(screen.getByRole('dialog', { name: '1인당 개수 바꾸기' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: '확인' })).toBeEnabled()
      await waitFor(() => expect(getCount()).toBe(2))

      await user.click(within(dialog).getByRole('button', { name: '취소' }))
      await waitFor(() => expect(rowTexts()).toEqual([['골프공', '골프 챌린지 투어', '3개', '20개']]))
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      // 다시 보내도 결과가 같아 단추는 막지 않는다
      expect(within(rowOf('골프공')).getByRole('button', { name: '1인당 개수 바꾸기' })).toBeEnabled()
    },
  )

  it('보내는 동안 창을 닫을 수 없지만, 화면 이동은 막지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [golfBall])).mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
    await user.click(within(dialog).getByRole('button', { name: '확인' }))

    expect(within(dialog).getByRole('button', { name: '처리하는 중' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '취소' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '1인당 개수 바꾸기' })).toBeInTheDocument()
    expect(leaveBlocked()).toBe(false)
  })

  it('취소하면 보내지 않고 창을 닫는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [golfBall]))
    renderPage()
    await screen.findByRole('table')

    const { user, dialog } = await openDialog('골프공', '1인당 개수 바꾸기', '3')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
