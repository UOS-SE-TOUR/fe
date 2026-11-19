import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { MenuLink } from '@/components/MenuLink'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { themeLabel, themes, type Theme } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { themeLookOf } from '@/lib/themeLook'
import { useBlockLeaving } from '@/lib/useBlockLeaving'
import { cn } from '@/lib/utils'
import { ApiClient, ApiError, hasStatus, showError, unknownResult } from '@/modules/ApiClient'

const ITEMS_PATH = '/api/v1/staff/items'
// be가 수량을 int로 받는다
const MAX_QUANTITY = 2_147_483_647
// be의 Item.PER_PERSON_MAX
const MAX_PER_PERSON = 100
const PER_PERSON_HELP = '고객 한 명에게 주는 개수입니다. 주지 않으면 0을 넣습니다.'

// be의 ItemResponse. 수량은 확정된 상품에 줄 만큼 모자라면 음수(모자란 만큼)
interface Item {
  id: number
  name: string
  theme: string
  perPerson: number
  quantity: number
}

type ItemsState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: Item[] }

// 보내는 중인 요청
type Sending = 'register' | 'quantity' | 'perPerson' | null

// 물품 한 줄에서 여는 작은 창
type ItemDialog = { kind: 'quantity' | 'perPerson'; item: Item }

type Sent = { ok: true; body: unknown } | { ok: false; error: unknown }

function formatCount(count: number): string {
  return count.toLocaleString('ko-KR')
}

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false
  const { id, name, theme, perPerson, quantity } = value as Partial<Item>
  return (
    typeof id === 'number' &&
    typeof name === 'string' &&
    typeof theme === 'string' &&
    typeof perPerson === 'number' &&
    typeof quantity === 'number'
  )
}

type CheckedCount = { error: string } | { error: null; value: number }

function checkQuantity(text: string): CheckedCount {
  const trimmed = text.trim()
  if (trimmed === '') return { error: '수량을 입력해 주세요.' }
  const value = Number(trimmed)
  if (!/^[0-9]+$/.test(trimmed) || value < 1) return { error: '수량은 1 이상의 정수로 입력해 주세요.' }
  if (value > MAX_QUANTITY) return { error: '창고에 둘 수 있는 수량을 넘습니다.' }
  return { error: null, value }
}

function checkPerPerson(text: string): CheckedCount {
  const trimmed = text.trim()
  if (trimmed === '') return { error: '1인당 개수를 입력해 주세요.' }
  const value = Number(trimmed)
  if (!/^[0-9]+$/.test(trimmed) || value > MAX_PER_PERSON) {
    return { error: `1인당 개수는 0부터 ${MAX_PER_PERSON}까지의 정수로 입력해 주세요.` }
  }
  return { error: null, value }
}

type CheckedRegister =
  { error: string } | { error: null; name: string; theme: Theme; perPerson: number; quantity: number }

function checkRegisterInput(itemName: string, theme: Theme | '', perPerson: string, quantity: string): CheckedRegister {
  if (itemName.trim() === '') return { error: '물품 이름을 입력해 주세요.' }
  if (theme === '') return { error: '테마를 골라 주세요.' }
  const checkedPerPerson = checkPerPerson(perPerson)
  if (checkedPerPerson.error !== null) return { error: checkedPerPerson.error }
  const checkedQuantity = checkQuantity(quantity)
  if (checkedQuantity.error !== null) return { error: checkedQuantity.error }
  return { error: null, name: itemName, theme, perPerson: checkedPerPerson.value, quantity: checkedQuantity.value }
}

export function WarehousePage() {
  const [itemsState, setItemsState] = useState<ItemsState>({ status: 'loading' })
  const [itemName, setItemName] = useState('')
  const [theme, setTheme] = useState<Theme | ''>('')
  const [perPerson, setPerPerson] = useState('')
  const [quantity, setQuantity] = useState('')
  const [sending, setSending] = useState<Sending>(null)
  // 처리됐는지 모르는 등록·수량 더하기가 있었다. 목록을 다시 읽을 때까지 단추를 막는다
  const [needsRecheck, setNeedsRecheck] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  // 닫을 때 내용이 먼저 사라지지 않게, 연 물품은 닫아도 남겨 둔다
  const [dialog, setDialog] = useState<ItemDialog | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogValue, setDialogValue] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const loadSeq = useRef(0)
  const locked = sending !== null || needsRecheck
  // 다시 보내면 두 번 처리되는 요청이라 보내는 동안 떠나지 못하게 한다(1인당 개수 바꾸기는 다시 보내도 결과가 같다)
  const leavingBlocked = sending === 'register' || sending === 'quantity'
  useBlockLeaving(leavingBlocked, '처리가 끝날 때까지 이 화면에 있어 주세요.')

  // 늦게 온 앞선 응답은 버린다(바꾼 뒤 다시 읽은 목록을 덮지 않게)
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
        setItemsState({ status: 'loaded', items })
        setNeedsRecheck(false)
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        setItemsState({ status: 'failed' })
        showError(error)
      },
    )
  }, [])

  // 다시 읽는 동안 옛 수량을 지금 수량처럼 보이지 않게 표를 내린다
  function reload() {
    setItemsState({ status: 'loading' })
    loadItems()
  }

  useEffect(() => {
    loadItems()
  }, [loadItems])

  // 400·404는 창 안에 보인다. 404면 물품이 없어졌으니 목록도 다시 읽는다
  function showDialogFailure(error: ApiError) {
    setDialogError(error.message)
    if (error.status === 404) loadItems()
  }

  // 다시 읽기 전에 표의 그 물품도 바로 바꾼다(알린 값과 표의 값이 어긋나 보이지 않게)
  function showRow(item: Item) {
    setItemsState((prev) =>
      prev.status === 'loaded' ? { ...prev, items: prev.items.map((row) => (row.id === item.id ? item : row)) } : prev,
    )
  }

  function clearInput() {
    setItemName('')
    setPerPerson('')
    setQuantity('')
  }

  // 다시 보내지 않는다. 처리됐을 수 있어 목록을 다시 읽고, 다 읽을 때까지 단추를 막는다
  function showUnknownResult(error: ApiError) {
    setNeedsRecheck(true)
    showError(error)
    reload()
  }

  async function send(kind: NonNullable<Sending>, request: () => Promise<unknown>): Promise<Sent> {
    sendingRef.current = true
    setSending(kind)
    try {
      return { ok: true, body: await request() }
    } catch (error) {
      return { ok: false, error }
    } finally {
      sendingRef.current = false
      setSending(null)
    }
  }

  async function registerItem(name: string, itemTheme: Theme, perPersonCount: number, count: number) {
    const sent = await send('register', () =>
      ApiClient.post(
        ITEMS_PATH,
        { itemName: name, theme: itemTheme, perPerson: perPersonCount, quantity: count },
        { unsafeToRetry: true },
      ),
    )
    if (!sent.ok) {
      const { error } = sent
      if (hasStatus(error, 400)) setFormError(error.message)
      else if (error instanceof ApiError && error.resultUnknown) {
        // 이미 등록됐을 수 있어 입력을 비운다(다시 보내려면 다시 입력한다)
        clearInput()
        showUnknownResult(error)
      } else showError(error)
      return
    }
    // 성공 응답인데 본문이 물품이 아니면 처리됐는지 알 수 없다(빈 본문·객체가 아닌 본문은 ApiClient가 이미 던졌다)
    if (!isItem(sent.body)) {
      clearInput()
      showUnknownResult(unknownResult(null))
      return
    }
    setResult(`${sent.body.name} ${formatCount(sent.body.quantity)}개를 등록했습니다`)
    clearInput()
    loadItems()
  }

  async function addQuantity(item: Item, count: number) {
    const sent = await send('quantity', () =>
      ApiClient.post(`${ITEMS_PATH}/${item.id}/quantity`, { quantity: count }, { unsafeToRetry: true }),
    )
    if (!sent.ok) {
      const { error } = sent
      if (hasStatus(error, 400) || hasStatus(error, 404)) showDialogFailure(error)
      else if (error instanceof ApiError && error.resultUnknown) {
        setDialogOpen(false)
        showUnknownResult(error)
      } else showError(error)
      return
    }
    if (!isItem(sent.body)) {
      setDialogOpen(false)
      showUnknownResult(unknownResult(null))
      return
    }
    const added = sent.body
    setDialogOpen(false)
    const now =
      added.quantity < 0 ? `아직 ${formatCount(-added.quantity)}개 부족` : `지금 ${formatCount(added.quantity)}개`
    setResult(`${added.name} ${formatCount(count)}개를 더했습니다(${now})`)
    showRow(added)
    loadItems()
  }

  async function changePerPerson(item: Item, perPersonCount: number) {
    const sent = await send('perPerson', () =>
      ApiClient.post(`${ITEMS_PATH}/${item.id}/per-person`, { perPerson: perPersonCount }),
    )
    if (!sent.ok) {
      const { error } = sent
      if (hasStatus(error, 400) || hasStatus(error, 404)) showDialogFailure(error)
      else {
        // 다시 보내도 결과가 같아 창은 열어 둔다. 504·연결 끊김이면 바뀌었을 수 있어 표를 서버 값에 맞춘다
        showError(error)
        if (error instanceof ApiError && !error.handled) loadItems()
      }
      return
    }
    // 성공 응답인데 본문이 물품이 아니면 바뀌었는지 알 수 없다. 창을 닫고 목록을 다시 읽어 결과를 보게 한다
    if (!isItem(sent.body)) {
      setDialogOpen(false)
      showError(unknownResult(null))
      reload()
      return
    }
    const changed = sent.body
    setDialogOpen(false)
    setResult(`${changed.name}의 1인당 개수를 ${formatCount(changed.perPerson)}개로 바꿨습니다`)
    showRow(changed)
    loadItems()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingRef.current || needsRecheck) return
    setResult(null)
    const input = checkRegisterInput(itemName, theme, perPerson, quantity)
    setFormError(input.error)
    if (input.error !== null) return
    void registerItem(input.name, input.theme, input.perPerson, input.quantity)
  }

  function openDialog(kind: ItemDialog['kind'], item: Item) {
    setDialog({ kind, item })
    setDialogValue(kind === 'perPerson' ? String(item.perPerson) : '')
    setDialogError(null)
    setDialogOpen(true)
  }

  // 보내는 동안에는 닫지 않는다(Esc·바깥 누르기)
  function handleDialogOpenChange(open: boolean) {
    if (!open && !sendingRef.current) setDialogOpen(false)
  }

  function handleDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingRef.current || needsRecheck || dialog === null) return
    const checked = dialog.kind === 'quantity' ? checkQuantity(dialogValue) : checkPerPerson(dialogValue)
    setDialogError(checked.error)
    if (checked.error !== null) return
    setResult(null)
    if (dialog.kind === 'quantity') void addQuantity(dialog.item, checked.value)
    else void changePerPerson(dialog.item, checked.value)
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">창고</h1>
        <MenuLink to={pagePaths.StaffMainPage} label="직원 메뉴" disabled={leavingBlocked} />
      </header>

      <section className="panel flex flex-col gap-4" aria-labelledby="register-item-heading">
        <h2 id="register-item-heading" className="text-lg font-semibold">
          새 물품 등록
        </h2>
        <form className="grid gap-4 sm:grid-cols-2 sm:items-start" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-name">물품 이름</Label>
            {/* 보내는 동안 입력칸도 막는다(끝나면 입력을 비우므로 그사이 입력한 것이 사라진다) */}
            <Input
              id="item-name"
              value={itemName}
              disabled={sending === 'register'}
              onChange={(event) => setItemName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-theme">테마</Label>
            <NativeSelect
              id="item-theme"
              className="w-full"
              value={theme}
              disabled={sending === 'register'}
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
            <Label htmlFor="item-per-person">1인당 개수</Label>
            <Input
              id="item-per-person"
              inputMode="numeric"
              aria-describedby="item-per-person-help"
              value={perPerson}
              disabled={sending === 'register'}
              onChange={(event) => setPerPerson(event.target.value)}
            />
            <p id="item-per-person-help" className="text-sm text-muted-foreground">
              {PER_PERSON_HELP}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-quantity">처음 수량</Label>
            <Input
              id="item-quantity"
              inputMode="numeric"
              value={quantity}
              disabled={sending === 'register'}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={locked}>
            {sending === 'register' ? '등록하는 중' : '등록'}
          </Button>
        </form>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        {needsRecheck && (
          <p className="text-sm text-muted-foreground">물품 목록을 다시 불러온 뒤에 등록하거나 고칠 수 있습니다.</p>
        )}
        {/* 화면 읽기 프로그램이 바뀐 글을 읽게 영역은 늘 둔다. 비어 있을 땐 칸 아래 여백이 늘지 않게 사이 간격을 지운다 */}
        <p role="status" className="text-sm empty:-mt-4">
          {result}
        </p>
      </section>

      <section className="panel flex flex-col gap-4" aria-labelledby="items-heading">
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
                <TableHead className="text-right">1인당 개수</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>
                  <span className="sr-only">고치기</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsState.items.map((item) => {
                const look = themeLookOf(item.theme)
                return (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal">{item.name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {look && (
                          <span
                            className={cn('hidden size-6 items-center justify-center rounded-full sm:flex', look.tint)}
                          >
                            <look.icon className="size-3.5" />
                          </span>
                        )}
                        {themeLabel(item.theme)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{formatCount(item.perPerson)}개</TableCell>
                    <TableCell className="text-right">
                      {item.quantity < 0 ? (
                        <span className="font-medium text-destructive">부족 {formatCount(-item.quantity)}개</span>
                      ) : (
                        `${formatCount(item.quantity)}개`
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked}
                          onClick={() => openDialog('quantity', item)}
                        >
                          수량 더하기
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked}
                          onClick={() => openDialog('perPerson', item)}
                        >
                          1인당 개수 바꾸기
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          {dialog && (
            <form className="grid gap-6" onSubmit={handleDialogSubmit} noValidate>
              <DialogHeader>
                <DialogTitle>{dialog.kind === 'quantity' ? '수량 더하기' : '1인당 개수 바꾸기'}</DialogTitle>
                <DialogDescription>
                  {dialog.item.name} · {themeLabel(dialog.item.theme)}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="item-dialog-value">{dialog.kind === 'quantity' ? '더할 수량' : '1인당 개수'}</Label>
                <Input
                  id="item-dialog-value"
                  inputMode="numeric"
                  aria-describedby={dialog.kind === 'perPerson' ? 'item-dialog-help' : undefined}
                  value={dialogValue}
                  disabled={sending !== null}
                  onChange={(event) => setDialogValue(event.target.value)}
                />
                {dialog.kind === 'perPerson' && (
                  <p id="item-dialog-help" className="text-sm text-muted-foreground">
                    {PER_PERSON_HELP}
                  </p>
                )}
                {dialogError && (
                  <p role="alert" className="text-sm text-destructive">
                    {dialogError}
                  </p>
                )}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={sending !== null}>
                    취소
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={sending !== null}>
                  {sending !== null ? '처리하는 중' : '확인'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
