// 가이드 https://postcode.map.kakao.com/guide. 주소에 ?파라미터를 붙이면 스크립트가 스스로 멈춘다
export const POSTCODE_SCRIPT_URL = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
export const POSTCODE_LOAD_TIMEOUT_MS = 10_000

// userSelectedType은 R이면 도로명, J면 지번. 도로명과 지번이 1:N이면 주소 칸이 비고 auto 칸에 들 수 있다
export interface PostcodeData {
  zonecode: string
  roadAddress: string
  jibunAddress: string
  autoRoadAddress: string
  autoJibunAddress: string
  userSelectedType: 'R' | 'J'
}

interface PostcodeOptions {
  oncomplete: (data: PostcodeData) => void
  width: string
  height: string
}

interface Postcode {
  embed(element: HTMLElement): void
}

type PostcodeConstructor = new (options: PostcodeOptions) => Postcode

interface WithKakaoPostcode {
  kakao?: { Postcode?: PostcodeConstructor }
}

function postcodeClass(): PostcodeConstructor | null {
  return (window as Window & WithKakaoPostcode).kakao?.Postcode ?? null
}

let scriptLoading: Promise<void> | null = null

function loadScript(): Promise<void> {
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer)
      script.onload = null
      script.onerror = null
      scriptLoading = null
      if (loaded) return resolve()
      script.remove()
      reject(new Error('카카오 우편번호 서비스를 불러오지 못했다'))
    }
    // 응답 없이 멈춘 요청은 버리고 다음에 새로 붙인다. 늦게 받아 돌아도 kakao.Postcode를 다시 둘 뿐이다
    const timer = window.setTimeout(() => finish(false), POSTCODE_LOAD_TIMEOUT_MS)
    script.src = POSTCODE_SCRIPT_URL
    script.async = true
    script.onload = () => finish(postcodeClass() !== null)
    script.onerror = () => finish(false)
    document.head.append(script)
  })
  return scriptLoading
}

function formatAddress(data: PostcodeData): string {
  const selected =
    data.userSelectedType === 'J'
      ? data.jibunAddress || data.autoJibunAddress
      : data.roadAddress || data.autoRoadAddress
  return `(${data.zonecode}) ${selected || data.roadAddress || data.jibunAddress}`
}

// 카카오 우편번호 서비스의 어댑터(설계 3장). load()로 스크립트를 받은 뒤 embed()로 검색 화면을 띄운다
export const AddressSearch = {
  // 스크립트는 한 번만 받는다. 받지 못하면 거절하고, 다음에 부르면 다시 받는다
  async load(): Promise<void> {
    if (postcodeClass()) return
    await loadScript()
  },

  // 주소를 고르면 검색 화면은 스스로 닫히고, onselect로 `(우편번호) 주소`를 준다
  embed(element: HTMLElement, onselect: (address: string) => void) {
    const Constructor = postcodeClass()
    if (!Constructor) throw new Error('AddressSearch.load()가 끝난 뒤에 부른다')
    new Constructor({
      oncomplete: (data) => onselect(formatAddress(data)),
      width: '100%',
      height: '100%',
    }).embed(element)
  },
}
