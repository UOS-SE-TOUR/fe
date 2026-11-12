import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { themeLabel, themes, type Theme } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

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

function checkInput(itemName: string, theme: Theme | '', quantity: string): string | null {
  if (itemName.trim() === '') return '물품 이름을 입력해 주세요.'
  if (theme === '') return '테마를 골라 주세요.'
  const text = quantity.trim()
  if (text === '') return '수량을 입력해 주세요.'
  if (!/^[0-9]+$/.test(text) || Number(text) < 1) return '수량은 1 이상의 정수로 입력해 주세요.'
  if (Number(text) > MAX_QUANTITY) return '창고에 둘 수 있는 수량을 넘습니다.'
  return null
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
    ApiClient.get<Item[]>(ITEMS_PATH).then(
      (items) => {
        if (seq !== loadSeq.current) return
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

  useEffect(() => {
    loadItems()
  }, [loadItems])

  function showAddResult(name: string, added: number, current: number) {
    setAddResult(`${name} ${formatCount(added)}개를 더했습니다(지금 ${formatCount(current)}개)`)
  }

  async function addItem(name: string, itemTheme: Theme, count: number) {
    addingRef.current = true
    setAdding(true)
    try {
      const item = await ApiClient.post<Item>(
        ITEMS_PATH,
        { itemName: name, theme: itemTheme, quantity: count },
        { unsafeToRetry: true },
      )
      showAddResult(item.name, count, item.quantity)
      setItemName('')
      setQuantity('')
      loadItems()
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFormError(error.message)
      } else if (error instanceof ApiError && error.resultUnknown) {
        // 다시 보내지 않는다. 수량이 이미 더해졌을 수 있다
        setNeedsRecheck(true)
        showError(error)
        loadItems()
      } else {
        showError(error)
      }
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (addingRef.current || needsRecheck) return
    setAddResult(null)
    const inputError = checkInput(itemName, theme, quantity)
    setFormError(inputError)
    if (inputError || theme === '') return
    void addItem(itemName, theme, Number(quantity.trim()))
  }

  function reload() {
    setItemsState({ status: 'loading' })
    loadItems()
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">창고</h1>
        <Button variant="outline" asChild>
          <Link to={pagePaths.StaffMainPage}>직원 첫 화면</Link>
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
            <Input id="item-name" value={itemName} onChange={(event) => setItemName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-theme">테마</Label>
            <NativeSelect
              id="item-theme"
              className="w-full"
              value={theme}
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
        {addResult && (
          <p role="status" className="text-sm">
            {addResult}
          </p>
        )}
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
