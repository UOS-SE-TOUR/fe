import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { themeLabel, themes, type Theme } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { ApiClient, ApiError, showError, UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'

const ITEMS_PATH = '/api/v1/staff/items'
// be가 수량을 int로 받는다
const MAX_QUANTITY = 2_147_483_647

// be의 ItemResponse
interface Item {
  id: number
  name: string
  theme: string
  quantity: number
}

type ItemsState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: Item[] }

function formatCount(count: number): string {
  return count.toLocaleString('ko-KR')
}

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false
  const { id, name, theme, quantity } = value as Partial<Item>
  return typeof id === 'number' && typeof name === 'string' && typeof theme === 'string' && typeof quantity === 'number'
}

type CheckedInput = { error: string } | { error: null; name: string; theme: Theme; count: number }

function checkInput(itemName: string, theme: Theme | '', quantity: string): CheckedInput {
  if (itemName.trim() === '') return { error: '물품 이름을 입력해 주세요.' }
  if (theme === '') return { error: '테마를 골라 주세요.' }
  const text = quantity.trim()
  if (text === '') return { error: '수량을 입력해 주세요.' }
  const count = Number(text)
  if (!/^[0-9]+$/.test(text) || count < 1) return { error: '수량은 1 이상의 정수로 입력해 주세요.' }
  if (count > MAX_QUANTITY) return { error: '창고에 둘 수 있는 수량을 넘습니다.' }
  return { error: null, name: itemName, theme, count }
}

export function WarehousePage() {
  const [itemsState, setItemsState] = useState<ItemsState>({ status: 'loading' })
  const [itemName, setItemName] = useState('')
  const [theme, setTheme] = useState<Theme | ''>('')
  const [quantity, setQuantity] = useState('')
  const [adding, setAdding] = useState(false)
  // 처리됐는지 모르는 추가가 있었다. 목록을 다시 읽을 때까지 추가 단추를 막는다
  const [needsRecheck, setNeedsRecheck] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [addResult, setAddResult] = useState<string | null>(null)
  const addingRef = useRef(false)
  const loadSeq = useRef(0)

  const showItems = useCallback((items: Item[]) => {
    setItemsState({ status: 'loaded', items })
  }, [])

  // 늦게 온 앞선 응답은 버린다(추가한 뒤 다시 읽은 목록을 덮지 않게)
  const loadItems = useCallback(() => {
    const seq = ++loadSeq.current
    ApiClient.get<unknown>(ITEMS_PATH).then(
      (items) => {
        if (seq !== loadSeq.current) return
        // 성공 응답인데 본문이 목록이 아니면(빈 본문 등) 못 읽은 것으로 다룬다
        if (!Array.isArray(items) || !items.every(isItem)) {
          setItemsState({ status: 'failed' })
          showError(new Error('창고 물품 목록 응답이 물품 배열이 아니다'))
          return
        }
        showItems(items)
        setNeedsRecheck(false)
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        setItemsState({ status: 'failed' })
        showError(error)
      },
    )
  }, [showItems])

  // 다시 읽는 동안 옛 수량을 지금 수량처럼 보이지 않게 표를 내린다
  function reload() {
    setItemsState({ status: 'loading' })
    loadItems()
  }

  useEffect(() => {
    loadItems()
  }, [loadItems])

  function showAddResult(name: string, added: number, current: number) {
    setAddResult(`${name} ${formatCount(added)}개를 더했습니다(지금 ${formatCount(current)}개)`)
  }

  function clearInput() {
    setItemName('')
    setQuantity('')
  }

  // 다시 보내지 않는다. 수량이 이미 더해졌을 수 있어 입력을 비우고(다시 보내려면 다시 입력한다) 목록을 다시 읽는다
  function showUnknownResult(error: ApiError) {
    setNeedsRecheck(true)
    clearInput()
    showError(error)
    reload()
  }

  async function addItem(name: string, itemTheme: Theme, count: number) {
    addingRef.current = true
    setAdding(true)
    let item: unknown
    try {
      item = await ApiClient.post<unknown>(
        ITEMS_PATH,
        { itemName: name, theme: itemTheme, quantity: count },
        { unsafeToRetry: true },
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) setFormError(error.message)
      else if (error instanceof ApiError && error.resultUnknown) showUnknownResult(error)
      else showError(error)
      return
    } finally {
      addingRef.current = false
      setAdding(false)
    }
    // 성공 응답인데 본문이 물품이 아니면 처리됐는지 알 수 없다(빈 본문은 ApiClient가 이미 던졌다)
    if (!isItem(item)) {
      showUnknownResult(new ApiError(UNKNOWN_RESULT_MESSAGE, null, { resultUnknown: true }))
      return
    }
    const added = item
    showAddResult(added.name, count, added.quantity)
    clearInput()
    // 다시 읽기 전에 표의 그 물품도 바로 바꾼다(알린 수량과 표의 수량이 어긋나 보이지 않게)
    setItemsState((prev) =>
      prev.status === 'loaded'
        ? { ...prev, items: prev.items.map((row) => (row.id === added.id ? added : row)) }
        : prev,
    )
    loadItems()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (addingRef.current || needsRecheck) return
    setAddResult(null)
    const input = checkInput(itemName, theme, quantity)
    setFormError(input.error)
    if (input.error !== null) return
    void addItem(input.name, input.theme, input.count)
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">창고</h1>
        <Button variant="outline" asChild>
          <Link to={pagePaths.StaffMainPage}>직원 메뉴</Link>
        </Button>
      </header>

      <section className="flex flex-col gap-4" aria-labelledby="add-item-heading">
        <h2 id="add-item-heading" className="text-lg font-semibold">
          물품 추가
        </h2>
        <form
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_7rem_auto] sm:items-end"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-name">물품 이름</Label>
            {/* 보내는 동안 입력칸도 막는다(끝나면 입력을 비우므로 그사이 입력한 것이 사라진다) */}
            <Input
              id="item-name"
              value={itemName}
              disabled={adding}
              onChange={(event) => setItemName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-theme">테마</Label>
            <NativeSelect
              id="item-theme"
              className="w-full"
              value={theme}
              disabled={adding}
              onChange={(event) => setTheme(event.target.value as Theme | '')}
            >
              <NativeSelectOption value="" disabled>
                테마 선택
              </NativeSelectOption>
              {themes.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-quantity">수량</Label>
            <Input
              id="item-quantity"
              inputMode="numeric"
              value={quantity}
              disabled={adding}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={adding || needsRecheck}>
            {adding ? '추가하는 중' : '추가'}
          </Button>
        </form>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        {needsRecheck && (
          <p className="text-sm text-muted-foreground">물품 목록을 다시 불러온 뒤에 추가할 수 있습니다.</p>
        )}
        {/* 화면 읽기 프로그램이 바뀐 글을 읽게 영역은 늘 둔다 */}
        <p role="status" className="text-sm">
          {addResult}
        </p>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="items-heading">
        <h2 id="items-heading" className="text-lg font-semibold">
          물품 목록
        </h2>
        {itemsState.status === 'loading' && (
          <p className="text-sm text-muted-foreground">물품 목록을 불러오는 중입니다.</p>
        )}
        {itemsState.status === 'failed' && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">물품 목록을 불러오지 못했습니다.</p>
            <Button variant="outline" size="sm" onClick={reload}>
              다시 불러오기
            </Button>
          </div>
        )}
        {itemsState.status === 'loaded' && itemsState.items.length === 0 && (
          <p className="text-sm text-muted-foreground">창고에 물품이 없습니다.</p>
        )}
        {itemsState.status === 'loaded' && itemsState.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>테마</TableHead>
                <TableHead className="text-right">수량</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsState.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal">{item.name}</TableCell>
                  <TableCell>{themeLabel(item.theme)}</TableCell>
                  <TableCell className="text-right">{formatCount(item.quantity)}개</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </main>
  )
}
