# CLAUDE.md

## 프로젝트

- **MWT Web Client** — 미스터 월드 테마 여행 서비스의 화면. 소프트웨어공학(26-2) 팀 최백문 과제.
- React 19 / TypeScript 6 / Vite 8 / Tailwind CSS 4 / shadcn/ui(`radix-vega`) / npm, Node 22.23.2(`.nvmrc`).
- 설계 정본은 [UOS-SE-TOUR/docs](https://github.com/UOS-SE-TOUR/docs)의 설계산출물(3장 화면 클래스·4.9 서버 API 표·5장 교류도)과 분석산출물(유즈케이스). 화면·부품·함수 이름은 설계를 그대로 쓴다.
- 서버 규칙은 [UOS-SE-TOUR/be](https://github.com/UOS-SE-TOUR/be) README("화면과 연결"·"오류 응답"·"로그인과 권한")와 Swagger(`/api/swagger-ui.html`)가 정본이다.

## 구조

- 설계 클래스 하나에 파일 하나: «Page»는 `src/pages/<이름>.tsx`, «Component»는 `src/components/<이름>.tsx`, «Module»은 `src/modules/<이름>.ts`.
- `src/components/ui/`·`src/hooks/`·`src/lib/utils.ts`는 shadcn/ui가 만든 파일이다. `npx shadcn add <이름>`으로만 더하고 손으로 고치지 않는다(ESLint·셀프 리뷰 대상도 아니다).
- 서버는 `ApiClient`로만 부르고, 주소는 `/api/v1/...` 경로만 쓴다. 서버 도메인을 코드·`VITE_` 환경변수에 두지 않는다.
- 로그인 상태는 `members/login`·`members/me` 응답으로만 판단한다(로그인 쿠키는 HttpOnly라 읽을 수 없다).
- 직원 코드 같은 비밀 값은 코드·`.env`에 넣지 않는다.

## 코딩 규칙

- 주석·문서는 한국어로 쓰고, 주석은 최소화한다.
- 예외: `.claude/skills/` 스크립트는 판정 기준과 그 근거(실측·겪은 사고)를 머리말과 판정 옆 주석에 남긴다.
- 스타일은 Tailwind 클래스와 shadcn/ui 부품으로만 쓴다. `src/index.css` 밖에 CSS 파일·인라인 `style`을 만들지 않는다.
- 색은 `bg-primary`·`text-muted-foreground` 같은 테마 이름으로 쓴다. `bg-zinc-900` 같은 색 값은 쓰지 않는다(바꿀 땐 `src/index.css`의 CSS 변수).
- 서버 오류 본문의 `message`는 그대로 화면에 보여 준다. 화면 문구는 사용자가 읽을 한국어로 쓴다.
- import는 `@/` 별칭으로 쓴다.
- 테스트는 Vitest + Testing Library로 쓰고, 화면 요소는 사용자가 보는 문구·역할(`getByRole`·`getByText`)로 찾는다.

## 빌드 / 실행

- 실행: `npm ci` → `npm run dev` → Chrome에서 `http://localhost:5173`.
- AI 기본 게이트: 코드·설정을 고쳤으면 `npm run lint && npm test && npm run build`(빌드에 타입 검사가 들어 있다).
- `.claude/skills/`를 고쳤으면 `bash .claude/skills/issue/tests/run.sh`를 통과시킨다.
- 운영 서버에 붙인 화면(`API_PROXY_TARGET`을 바꾼 로컬, Vercel 프리뷰·운영)에서는 읽기(GET)만 시험한다 — 가입·신청은 운영 DB에 남고 실제 문자가 나갈 수 있다.
## Git / 협업 규칙

- `main` 직접 push 금지. 흐름: **이슈 먼저** → 최신 `main`에서 `<타입>/<기능>` 브랜치 → PR 본문 첫 줄에 `Closes #<이슈번호>`.
- 기능 작업은 `/issue <번호> fe`로 한다(`.claude/skills/issue`).
- **Squash 머지 전용**(머지하면 브랜치 자동 삭제) — PR 제목이 곧 `main`의 커밋 메시지이므로 커밋 컨벤션(`feat: ...`)을 따른다.
- 커밋 메시지·이슈·PR은 한국어로 쓴다. 커밋·PR 어디에도 AI 관여 표기(Co-Authored-By, Generated with 등)를 넣지 않는다.
- PR 본문에 머지 조건·머지 담당 문장을 넣지 않는다.
- 스테이징은 파일을 지정해서 한다 — `git add -A` 금지.
- 이슈를 새로 만들기 전에 기존 이슈와 중복되는지 확인한다. 이슈·PR 본문은 올리기 전에 처음 읽는 팀원 기준으로 가독성을 점검한다.

## 타입 / 영역 라벨

커밋·브랜치·PR·라벨에 **같은 타입 어휘**를 쓴다.

- 타입: `feat` · `fix` · `refactor` · `docs` · `chore` — 라벨은 이 5개. 커밋에는 필요하면 `build` · `ci` · `style` · `test` · `perf`도 쓴다.
- 영역(be 모듈 이름과 같다): `area: member`(로그인·가입·첫 화면) · `area: booking`(상품 선택·옵션·가격·신청·이전 여행) · `area: voice`(음성 입력) · `area: tour`(상품 기획) · `area: warehouse`(창고)
- 이슈·PR에는 **타입 라벨 1개**를 붙이고, 작업이 한 영역에 분명히 속하면 그 **영역 라벨 1개**를 더 붙인다. 여러 영역에 걸치거나 영역 밖(빌드 설정·문서·스킬) 작업은 영역 라벨 없이 둔다.
