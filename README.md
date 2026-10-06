# 우리의 결혼 준비

타임라인과 신혼집 자금 계획 표, 두 화면으로 준비하는 한국어 웹앱입니다.
GitHub Pages가 화면을 제공하고, 개인 준비 기록은 Supabase 공동 공간에 저장합니다.

## 사용하기

- **타임라인**: 제목·담당·월/날짜·메모를 직접 수정하고 완료를 체크합니다.
- **신혼집 자금 계획**: 항목 × 월 표에서 금액을 수정하면 월별 수입·지출·대출·상환과 잔액을 다시 계산합니다.
- 칸을 수정한 뒤 Enter 또는 다른 칸으로 이동하면 자동 저장합니다. 따로 가져오기·공동 저장 버튼을 누르지 않습니다.
- 두 기기에서 같은 공유 링크를 한 번 열면 이후 자동 연결됩니다. 계정·로그인·SMTP 설정은 없습니다.
- 다른 기기의 변경은 WebSocket 알림을 통해 자동 반영합니다. 연결이 끊기면 기기에 수정을 보관하고 재연결 후 저장합니다.
- 공유 아이콘에서 다른 기기 연결 링크와 JSON 백업을 사용할 수 있습니다.

기존 예산·업체·기록 데이터는 백업과 공동 데이터에 보존하지만 화면에는 표시하지 않습니다.
원본 엑셀의 월 단위 일정은 특정 날짜로 추정하지 않습니다.

[웹사이트](https://2080fresh.github.io/wed-plan/) · [공동 사용 안내](docs/SHARED-SETUP.md)

## 개발 및 배포

Node.js 22 이상과 pnpm 11을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

GitHub Pages Source를 GitHub Actions로 선택합니다. `main` push 시 테스트·빌드 후 배포합니다.
`VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`는 공개 프로젝트 설정이며 Actions 변수 또는 로컬 `.env.local`에 지정합니다.
공유 토큰과 개인 준비 내용을 소스나 공개 환경 변수에 넣지 않습니다.

## 구성

- `src/App.tsx`: 두 화면과 공유/백업
- `src/SimpleTimeline.tsx`: 일정 직접 편집
- `src/SimpleCashflow.tsx`, `src/cashflowGrid.ts`: 월별 자금 표
- `src/autoSync.ts`, `src/useSharedPlan.ts`: 자동 저장, 오프라인 수정 보관, 변경 병합
- `src/realtime.ts`: 내용 없는 변경 알림 수신
- `src/linkCloud.ts`: 공유 토큰으로 보호하는 읽기·저장 API
- `src/model.ts`, `src/cashflow.ts`: 데이터 검증과 계산
- `supabase/setup.sql`, `supabase/link-workspace.sql`, `supabase/link-notifications.sql`: 저장 및 알림 설치

원본 XLSX, `.analysis`, `output`, `.env.local`과 개인 공유 링크는 Git 제외 대상입니다.
배포 파일에 개인 기록을 포함하지 않습니다.
