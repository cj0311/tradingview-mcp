# TradingView Desktop Compatibility Plan

작성일: 2026-06-12
대상 저장소: https://github.com/cj0311/tradingview-mcp
체크아웃 커밋: `3b7039e7439307e6e9619392d9144c89884d5e76`

## 결론

현재 로컬 TradingView Desktop 3.2.0.7916에서는 핵심 차트 읽기, 심볼/타임프레임 제어, OHLCV/quote 조회, pane/replay 상태 조회, screenshot, Pine facade 직접 검사는 대체로 동작한다. 3.1.0.7818에서 발견한 실패 목록은 3.2.0.7916에서도 동일하게 재현된다.

다만 TradingView Desktop 3.x와 Windows Store/App Installer 배포 방식 기준으로 즉시 수정해야 할 호환성 결함이 있다. 특히 `bottomWidgetBar` 메서드명이 현재 앱 표면과 맞지 않아 Pine Editor/Strategy Tester panel 제어가 거짓 성공을 반환하며, Windows 설치 경로 자동 탐지가 Microsoft Store 설치를 놓친다.

공식 TradingView Desktop 최신 릴리스는 2026-06-03의 3.2.0이며, 업데이트 후 로컬 환경에서 3.2.0.7916 실기기 검증을 완료했다. 업데이트 직후 앱은 일반 모드로 실행되어 CDP 9222 포트가 닫혀 있었고, 기존 인스턴스를 종료한 뒤 `--remote-debugging-port=9222`로 재시작해야 했다.

공식 참고:
- https://www.tradingview.com/support/solutions/43000673888-tradingview-desktop-releases-and-release-notes/
- https://www.tradingview.com/support/solutions/43000624193-system-requirements-for-tradingview-desktop-app/

## 검증 환경

- OS: Windows
- Node.js: `v24.13.1`
- npm: `11.7.0`
- TradingView Desktop 로컬 설치: `TradingView.Desktop_3.2.0.7916_x64__n534cwy3pjxzj`
- CDP user agent: `TradingView/3.2.0 Chrome/140.0.7339.133 Electron/38.2.2 TVDesktop/3.2.0`
- CDP target: `https://kr.tradingview.com/chart/nvwy2D9k/`
- 현재 차트: `BINANCE:BTCUSDT.P`, `15`, candles

## 실행 결과

| 검사 | 결과 | 메모 |
| --- | --- | --- |
| `npm ci` | 성공 | 94 packages 설치 |
| `node src/cli/index.js status` | 성공 | CDP 연결 및 chart API 사용 가능 |
| `node src/cli/index.js discover` | 부분 성공 | 6개 path 중 5개 사용 가능, `_alertService` 없음 |
| `node src/cli/index.js state` | 성공 | 심볼, 해상도, study 목록 조회 가능 |
| `node src/cli/index.js quote` | 성공 | OHLCV 기반 quote 조회 가능 |
| `npm run test:e2e` | 실패 | 3.2.0.7916에서 79개 중 75개 통과, 4개 실패 |
| `npm run test:unit` | 실패 | 3.2.0.7916 재검증에서도 29개 중 27개 통과, CLI `pine check` 2개 실패 |
| `npm audit --json` | 실패 | 6개 취약점, lockfile 범위에서 fix 가능 |

## 언어 설정 재검증

2026-06-12에 TradingView UI를 영어로 변경한 뒤 3.2.0.7916에서 다시 검증했다.

- CDP target URL이 `https://www.tradingview.com/chart/...`로 바뀌었고 target title도 영어로 바뀌었다.
- `ui-state`에서 `Indicators`, `Create alert`, `Bar replay`, `Add to chart`, `Saved`, `Publish script`, `Collapse panel`, `Maximize panel` 등 주요 버튼 라벨이 영어로 확인되었다.
- 영어 UI로 인해 DOM/text fallback의 성공 가능성은 높아졌다.
- 그러나 E2E 실패 목록은 그대로다. 남은 4개 실패는 언어 문제가 아니라 Windows/AppX launch 탐지, `bottomWidgetBar` API 변경, replay stop 호출 순서, drawing test 상태 의존성 문제다.
- `node src/cli/index.js ui panel pine-editor close`는 영어 UI에서도 `{ success: true, performed: "closed" }`를 반환하지만 실제 `pine_editor.open=true`로 남는다.

## 호환성 이슈 목록

### TVC-001: Windows Store 설치 자동 탐지 실패

상태: 확인됨
영향도: 높음
관련 파일:
- `src/core/health.js`
- `scripts/launch_tv_debug.bat`
- `tests/e2e.test.js`

근거:
- 로컬 TradingView는 업데이트 후 `C:\Program Files\WindowsApps\TradingView.Desktop_3.2.0.7916_x64__n534cwy3pjxzj\TradingView.exe`에 설치되어 있다.
- `src/core/health.js`의 Windows pathMap은 `%LOCALAPPDATA%\TradingView`, `%PROGRAMFILES%\TradingView`, `%PROGRAMFILES(X86)%\TradingView`만 확인한다.
- 배치 스크립트는 `WindowsApps\TradingView*\TradingView.exe`를 찾지만 core `launch()`는 같은 탐지를 하지 않는다.
- E2E의 `tv_launch` 테스트는 macOS 경로만 검사해서 Windows에서 실패한다.
- 업데이트 직후 일반 모드로 실행된 TradingView는 CDP 포트가 열리지 않았고, 기존 프로세스가 떠 있는 상태에서 같은 exe를 디버그 플래그로 다시 실행해도 CDP가 열리지 않았다.

수정 계획:
1. Windows 전용 탐지 함수를 만든다.
2. 우선순위는 기존 경로, App Execution Alias 또는 `where TradingView.exe`, AppX package install location, `WindowsApps\TradingView.Desktop_*` glob 순으로 둔다.
3. `Get-AppxPackage TradingView.Desktop`를 사용할 때는 PowerShell이 없는 환경을 고려해 실패를 무시한다.
4. `tv_launch --no-kill` 테스트 모드를 추가하거나, path resolution만 분리한 pure function을 테스트한다.
5. Windows, macOS, Linux path test fixture를 분리한다.

검증:
- `node src/cli/index.js launch --no-kill`
- `node --test tests/e2e.test.js --test-name-pattern "tv_launch"`

### TVC-002: `bottomWidgetBar` API 변경으로 panel 제어가 깨짐

상태: 확인됨
영향도: 높음
관련 파일:
- `src/core/ui.js`
- `src/core/pine.js`
- `src/core/health.js`
- `tests/e2e.test.js`

현재 3.1.0에서 발견된 메서드:
`open`, `close`, `hide`, `show`, `toggleMaximize`, `toggleMinimize`

현재 3.2.0.7916에서도 동일하게 발견된 메서드:
`open`, `close`, `hide`, `show`, `toggleMaximize`, `toggleMinimize`

기존 코드가 기대하는 메서드:
`activateScriptEditorTab`, `showWidget`, `hideWidget`

증상:
- `node src/cli/index.js ui panel pine-editor close`가 성공처럼 응답하지만 실제로는 `hideWidget`가 없어 닫지 못한다.
- 3.2.0.7916에서 재검증한 결과, `ui panel pine-editor close`는 `{ success: true, performed: "closed" }`를 반환하지만 `ui-state`상 `pine_editor.open=true`로 남아 있다.
- `npm run test:e2e`의 `ui_open_panel`은 `window.TradingView.bottomWidgetBar.hideWidget is not a function`로 실패한다.
- `ensurePineEditorOpen()`도 `showWidget`/`activateScriptEditorTab` 중심이라 Pine Editor가 이미 열려 있지 않은 상태에서 불안정하다.

수정 계획:
1. `bottomWidgetBar` adapter를 만든다.
2. adapter는 현재 API 후보를 순서대로 시도한다:
   - open: `activateScriptEditorTab()`, `showWidget(name)`, `show(name)`, `open(name)`, DOM 버튼 클릭 fallback
   - close: `hideWidget(name)`, `hide(name)`, `close(name)`, close 버튼 DOM fallback
3. 실행 뒤 DOM 상태를 재검증하고, 상태 변화가 없으면 success가 아니라 warning 또는 error를 반환한다.
4. `pine.js`와 `ui.js`가 같은 adapter를 사용하게 중복 로직을 제거한다.
5. 한국어/영어 UI 모두에서 동작하도록 `[data-name]`, role, aria fallback을 유지하되 마지막 수단으로만 쓴다.

검증:
- `node src/cli/index.js ui panel pine-editor close`
- `node src/cli/index.js ui panel pine-editor open`
- `node src/cli/index.js pine get`
- `node --test tests/e2e.test.js --test-name-pattern "ui_open_panel|pine_get_source|pine_set_source"`

### TVC-003: `window.TradingViewApi._alertService`가 현재 표면에 없음

상태: 확인됨
영향도: 중간
관련 파일:
- `src/connection.js`
- `src/core/health.js`
- `src/core/alerts.js`

근거:
- `node src/cli/index.js discover` 결과 `alertService.available=false`.
- 현재 alert list는 `pricealerts.tradingview.com/list_alerts` fetch로 동작하므로 즉시 전체 alert 기능이 중단되지는 않는다.
- 다만 `KNOWN_PATHS.alertService`가 발견 항목에 남아 있어 health/discovery 문서와 실제 의존성이 어긋난다.

수정 계획:
1. `_alertService`를 필수 path가 아니라 optional capability로 분류한다.
2. `discover()` 결과에 capability별 필수/선택 상태를 명시한다.
3. alert create/delete는 DOM/REST fallback 상태를 명확히 반환한다.
4. 개별 alert delete가 아직 미지원이면 `not_supported`로 반환하고 문서화한다.

검증:
- `node src/cli/index.js discover`
- `node src/cli/index.js alert list`

### TVC-004: CLI `pine check`가 Node 24/Windows에서 JSON 출력 후 비정상 종료

상태: 확인됨
영향도: 중간
관련 파일:
- `src/cli/router.js`
- `src/core/pine.js`
- `tests/cli.test.js`

증상:
- `pine check`는 성공 JSON을 출력하지만 종료 코드가 `-1073740791` 또는 `3221226505`가 된다.
- Node 내부 assertion: `!(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`
- 같은 `core.check()` 직접 테스트는 통과한다.

추정 원인:
- CLI router가 async 작업 직후 `process.exit(0)`를 강제 호출하면서 Node 24 Windows의 fetch/stdio handle 종료와 충돌한다.

수정 계획:
1. `src/cli/router.js`에서 성공 경로의 `process.exit(0)`를 제거한다.
2. 오류 경로도 가능하면 `process.exitCode = 1|2` 후 return으로 정리한다.
3. stdout/stderr flush를 자연 종료에 맡긴다.
4. Node 18, 20, 22, 24 Windows matrix에서 CLI 테스트를 돌린다.

검증:
- `"//@version=6\nindicator('ok')\nplot(close)" | node src/cli/index.js pine check`
- `npm run test:unit`

### TVC-005: E2E drawing 테스트가 상태 의존적이고 flaky

상태: 확인됨
영향도: 낮음
관련 파일:
- `tests/e2e.test.js`
- `src/core/drawing.js`

근거:
- `npm run test:e2e`에서 `draw_list`가 `Has at least one shape`로 실패했다.
- 별도 순차 재현에서는 `draw shape -> draw list -> draw get -> draw remove`가 정상 동작했다.

수정 계획:
1. `draw_shape` 테스트가 반환한 entity ID를 suite state에 저장한다.
2. `draw_list`는 전체 count 대신 해당 ID 포함 여부를 확인한다.
3. 테스트 간 병렬/순서 의존성을 제거한다.
4. cleanup 실패 시에도 후속 테스트가 계속되도록 `after`에서 best-effort remove를 수행한다.

검증:
- `node --test tests/e2e.test.js --test-name-pattern "Drawing"`

### TVC-006: Replay stop API 호출 순서가 현재 3.1.0에서 불안정

상태: 확인됨
영향도: 중간
관련 파일:
- `src/core/replay.js`
- `tests/e2e.test.js`

근거:
- `npm run test:e2e`에서 `replay_stop`이 `Assertion failed: Replay is not started`로 실패했다.
- 현재 `src/core/replay.js`는 started 상태를 확인한 뒤 `stopReplay()`를 호출하고 toolbar hide를 시도한다.
- 테스트는 `stopReplay()`, `goToRealtime()`, `hideReplayToolbar()`를 직접 연속 호출한다.

수정 계획:
1. replay adapter에서 `isReplayStarted()`를 각 단계 직전에 다시 확인한다.
2. `goToRealtime`과 `stopReplay`의 가용성을 feature-detect한다.
3. 이미 realtime이면 성공 with `action: already_stopped`로 처리한다.
4. 에러 메시지가 `Replay is not started`이면 idempotent stop 성공으로 정규화한다.

검증:
- `node src/cli/index.js replay status`
- `node src/cli/index.js replay stop`
- `node --test tests/e2e.test.js --test-name-pattern "Replay Mode"`

### TVC-007: 3.2.0 최신 버전 실검증 완료

상태: 완료
영향도: 정보
관련 파일:
- 전체 CDP/internal API 의존 모듈

근거:
- 공식 최신 Desktop 3.2.0으로 업데이트 후 로컬 설치가 `TradingView.Desktop_3.2.0.7916_x64__n534cwy3pjxzj`로 확인되었다.
- CDP user agent는 `TradingView/3.2.0 Chrome/140.0.7339.133 Electron/38.2.2 TVDesktop/3.2.0`이다.
- `status`, `discover`, `state`, `ui-state`, `quote`는 3.2.0.7916에서 실행 가능했다.
- `npm run test:e2e` 결과는 3.1.0과 동일하게 79개 중 75개 통과, 4개 실패다.
- `npm run test:unit` 결과는 29개 중 27개 통과, CLI `pine check` 2개 실패다.

후속 계획:
1. TVC-001, TVC-002, TVC-004, TVC-006을 우선 수정한다.
2. 수정 후 3.2.0.7916에서 전체 E2E를 다시 실행한다.
3. 이후 TradingView Desktop 업데이트마다 `/json/version`, `discover`, `ui-state`, E2E 결과를 이 문서에 누적한다.

검증:
- `node src/cli/index.js status`
- `node src/cli/index.js discover`
- `npm run test:e2e`

### TVC-008: MCP SDK transitive dependency 취약점

상태: 확인됨
영향도: 낮음에서 중간
관련 파일:
- `package.json`
- `package-lock.json`

근거:
- `npm audit` 결과 6개 취약점이 보고되었다. 5 moderate, 1 high.
- `npm audit fix --dry-run`은 lockfile 범위 내에서 `hono`, `@hono/node-server`, `fast-uri`, `ip-address`, `qs`, `express-rate-limit` 업데이트로 해결 가능하다고 보고했다.

수정 계획:
1. `npm audit fix`를 별도 커밋으로 수행한다.
2. MCP server start, CLI help, unit tests를 재검증한다.
3. `@modelcontextprotocol/sdk`를 `1.29.0`으로 올리는 것은 별도 변경으로 분리해 MCP protocol 회귀를 확인한다.

검증:
- `npm audit`
- `npm run test:unit`
- `node src/server.js` smoke test

### TVC-009: Strategy script 추가, 백테스트 결과 읽기, CSV 다운로드 호환성

상태: 확인됨
영향도: 높음
관련 파일:
- `src/core/pine.js`
- `src/core/data.js`
- `src/core/ui.js`
- `src/core/capture.js`
- 신규 권장: strategy result export/download tool

검증에 사용한 스크립트:
- `C:\Users\YCJ\Documents\onlybit\final_strategy_sets\higher_profit_12\OnlyBit BTC Donchian Breakout Trail v0.2 Long\strategy.pine`
- 대상 차트: `BINANCE:BTCUSDT.P`, `15`

근거:
- `pine analyze`와 server-side `pine check`는 해당 Pine strategy를 오류 없이 통과했다.
- `pine set --file`은 126 lines를 Pine Editor에 정상 주입했다.
- `node src/cli/index.js pine compile`은 현재 UI에서 `Add to chart` 대신 `Pine Save`를 선택해 `{ study_added: false }`가 되었다.
- DOM에서 보이는 `Add to chartAdd to chart` 버튼을 직접 클릭하면 전략은 차트에 정상 추가된다.
- 전략 추가 후 `state`에는 `OnlyBit BTC Donchian Breakout Trail v0.2 Long` study가 표시되었다.
- 그러나 `data strategy`, `data trades`, `data equity`는 모두 빈 결과를 반환했다.
- 원인은 `src/core/data.js`가 strategy 판별을 `metaInfo().is_price_study === false`에 의존하기 때문이다. 현재 TradingView 3.2.0.7916에서는 strategy meta가 `is_price_study: true`, `isTVScriptStrategy: true`, `id: StrategyScript$USER;...@tv-scripting` 형태로 노출된다.
- 실제 내부 객체에는 `reportData`와 `ordersData`가 존재한다. `reportData`는 `currency`, `settings.dateRange`, `performance.all`, `trades`, `filledOrders`, `marginUsage`, `buyHold`, `buyHoldPercent`를 포함한다.
- 직접 내부 API를 읽으면 테스트 전략의 결과가 확인되었다: `totalTrades=17`, `profitFactor=0.6468384479615673`, `netProfit=-150.45870634602937`, `maxStrategyDrawDown=264.6912123475122`.
- Strategy Tester 하단 패널은 열려 있었지만 `ui-state.strategy_tester.open=false`로 표시되었다. 현재 감지는 `Strategy Tester` 텍스트 또는 `[data-name="backtesting"]`에 의존하는데, 실제 UI는 전략명과 `List of trades` 중심으로 렌더링된다.
- `screenshot -r strategy_tester`는 패널이 실제로 열린 뒤 `screenshots\tv_strategy_tester_2026-06-12T13-56-06-825Z.png`를 생성했고, 거래 리스트 영역이 캡처되었다.
- UI의 `Download .csv` 버튼을 직접 클릭하면 `C:\Users\YCJ\Downloads\OnlyBit_BTC_Donchian_Breakout_Trail_v0.2_Long_BINANCE_BTCUSDT.P_2026-06-12_b7f46.csv`가 생성되었다.
- 다운로드 CSV는 34 rows이며 컬럼은 `Trade number`, `Type`, `Date and time`, `Signal`, `Price USDT`, `Size (qty)`, `Net PnL USD`, `Cumulative PnL USD` 등이다.
- 현재 MCP에는 Strategy Tester CSV 다운로드를 직접 수행하고 파일 경로를 반환하는 전용 command/tool이 없다.

수정 계획:
1. `pine.smartCompile()`의 버튼 탐지를 정규화한다. `Add to chartAdd to chart`처럼 텍스트가 중복되는 버튼도 `Add to chart`로 인식해야 한다.
2. compile 후에는 study count 또는 새 strategy id를 재검증하고, `Pine Save`만 실행된 경우 success로 처리하지 않는다.
3. strategy source 탐색 함수를 `data.js`에 공통화한다. 판별 조건은 `metaInfo().isTVScriptStrategy`, `metaInfo().id`의 `StrategyScript`, `reportData`, `_reportData`, `ordersData`, `_reportDataBuffer`를 함께 본다.
4. 여러 strategy가 있을 때는 `entity_id` 옵션을 받을 수 있게 하고, 옵션이 없으면 최근 추가된 strategy 또는 Strategy Tester 활성 전략을 선택한다.
5. `getStrategyResults()`는 `reportData.performance.all`, `performance.long`, `performance.short`, top-level drawdown/runup/openPL/buyHold 값을 flatten해서 반환한다.
6. `getTrades()`는 `ordersData`뿐 아니라 `reportData.trades`와 `reportData.filledOrders`를 지원한다. TradingView의 축약 필드(`e`, `x`, `rn`, `dd`, `tp`)를 사람이 읽기 쉬운 필드로 매핑한다.
7. `getEquity()`는 full equity curve가 없을 때 빈 성공 대신 `equity_summary`와 사용 가능한 series(`buyHold`, `buyHoldPercent`, `marginUsage`)를 명시해 반환한다.
8. Strategy Tester panel 감지는 텍스트 `Strategy Tester` 대신 bottom widget active name, strategy report root, `List of trades`, `Performance Summary`, `Download .csv` 버튼 등을 함께 사용한다.
9. `strategy download-csv` 또는 `data export-trades` command/tool을 추가한다. UI의 `Download .csv`를 클릭하고 새로 생성된 파일 경로, row count, columns를 반환한다.
10. 다운로드가 브라우저 설정 또는 native dialog 때문에 자동 저장되지 않는 환경에서는 DOM table을 직접 읽어 CSV를 생성하는 fallback을 둔다.

검증:
- `node src/cli/index.js pine set --file "<strategy.pine>"`
- `node src/cli/index.js pine compile`
- `node src/cli/index.js state`
- `node src/cli/index.js data strategy`
- `node src/cli/index.js data trades -n 10`
- `node src/cli/index.js data equity`
- `node src/cli/index.js screenshot -r strategy_tester`
- 신규: `node src/cli/index.js data export-trades --format csv`

### TVC-010: 여러 strategy 순차 조작과 async readiness 안정성

상태: 확인됨
영향도: 높음
관련 파일:
- `src/core/pine.js`
- `src/core/chart.js`
- `src/wait.js`
- `src/core/data.js`
- `src/core/capture.js`
- `src/core/watchlist.js`
- `src/core/alerts.js`
- `src/core/replay.js`

검증에 사용한 스크립트:
- `OnlyBit BTC Donchian Breakout Trail v0.2 Long`
- `OnlyBit BTC High Win MTF Score Single v1.2`
- `OnlyBit BTC Keltner Squeeze Trend Ride v0.2 Long`

근거:
- 3개 파일 모두 `pine analyze`와 server-side `pine check`는 통과했다.
- 같은 차트에 순차 추가를 시도했을 때 `pine set` 자체는 각 4-6ms 수준으로 빠르게 성공했다.
- `setSymbol('BINANCE:BTCUSDT.P')`는 실제 차트를 BTC로 변경했지만 10.728초 뒤 `{ chart_ready: false }`를 반환했다. 원인은 `waitForChartReady()`가 헤더 텍스트 `BTCUSDT.P`와 기대값 `BINANCE:BTCUSDT.P`를 단순 `includes()`로 비교하기 때문이다.
- `setTimeframe('15')`는 1.327초에 `{ chart_ready: true }`로 끝났다.
- 첫 번째와 두 번째 strategy는 toolbar의 `Add to chart` 클릭이 성공처럼 처리됐지만 12초 대기 후에도 새 study가 생기지 않았다.
- 추가 조사 결과 TradingView가 `Cannot add a script with unsaved changes to chart. Do you want to save them?` 확인 dialog를 띄우며, 실제 추가에는 `Save and add to chart`를 한 번 더 눌러야 한다.
- `Save and add to chart`는 현재 Pine script 저장을 동반한다. 여러 strategy 자동 검증에서는 사용자 script를 덮어쓰지 않도록 전용 scratch script 또는 저장 전후 source 보호 절차가 필요하다.
- 현재 `pine.smartCompile()`은 `Add to chart` 또는 `Save and add to chart` 중 하나를 한 번만 누르고 종료한다. `Add to chart -> confirmation -> Save and add to chart` 2단계 흐름을 처리하지 않는다.
- 현재 UI에서는 Pine toolbar의 `Add to chart`가 텍스트 없는 icon button으로 노출되고 `title="Add to chart"`만 가진다. `pine.smartCompile()`의 `^add to chart$` 텍스트 매칭은 이 버튼을 안정적으로 찾지 못한다.
- 세 번째 strategy는 새 entity `B97tuz`로 추가됐고 reportData 준비까지 1.599초가 걸렸다. 같은 환경에서도 strategy별 UI 상태와 dialog 잔류 여부에 따라 결과가 달라진다.
- strategy를 여러 개 올리면 Strategy Tester 하단 패널은 마지막 활성 strategy 중심으로 렌더링된다. `Download .csv`도 현재 활성 trade list만 내려받는다.
- 여러 strategy가 있을 때 현재 `data strategy/trades/equity`에는 `entity_id` 또는 strategy name 선택 옵션이 없어서 어떤 strategy 결과를 읽어야 하는지 표현할 방법이 없다.
- 테스트 중 추가된 사용자 strategy들의 `metaInfo().id`가 같은 `StrategyScript$USER;...@tv-scripting` 값을 공유할 수 있었다. 따라서 `metaInfo().id`는 strategy instance 식별자로 쓰면 안 되고, chart entity id와 표시명을 함께 써야 한다.
- 기존 사용자 strategy `BB.ALL.krx.RSI.4.TRADE.9.55`는 차트를 BTC 15분으로 바꾸자 reportData가 BTC 기준으로 재계산되었다. 여러 strategy 자동화에서는 결과와 함께 symbol/resolution snapshot을 반드시 기록해야 한다.
- `data strategy`, `data trades`, `data equity`는 여러 strategy가 올라간 상태에서도 여전히 빈 결과를 반환했다. 이는 TVC-009의 strategy 판별 문제와 같은 원인이다.

수정 계획:
1. `waitForChartReady()`는 `chart.symbol()` / `symbolExt()` 같은 내부 API를 우선 사용하고, DOM header는 fallback으로만 사용한다.
2. expected symbol 비교는 exchange prefix 유무를 정규화한다. 예: `BINANCE:BTCUSDT.P`와 `BTCUSDT.P`를 같은 심볼로 판단한다.
3. 모든 mutating command는 고정 sleep 뒤 success를 반환하지 말고, 실제 상태 변화 predicate를 polling한다.
4. `pine.smartCompile()`은 2단계 add flow를 지원한다: `Add to chart` 클릭, confirmation 감지, `Save and add to chart` 클릭, study/reportData 준비 polling.
5. 여러 strategy batch test는 전용 scratch script에서 실행하거나, 저장 전후 source를 보존하고 저장 여부를 명시적으로 반환한다.
6. toolbar button 탐지는 `textContent`뿐 아니라 `title`, `aria-label`, role, disabled state를 함께 본다.
7. dialog가 남아 있으면 다음 strategy 조작 전에 닫거나 처리한다. 남은 confirmation dialog가 다음 클릭을 가로막을 수 있다.
8. strategy 추가 결과는 새 entity id, 표시명, chart symbol/resolution, reportData ready 여부, 준비 시간을 반환한다.
9. `data strategy/trades/equity`에 `entity_id`, `strategy_name`, `active` 옵션을 추가한다.
10. Strategy Tester CSV 다운로드 tool은 다운로드 전에 대상 strategy를 활성화하거나, 선택하지 못하면 명확히 `ambiguous_strategy`를 반환한다.
11. timeout은 feature별로 분리한다. symbol/timeframe 변경, Pine compile, reportData 준비, CSV download는 서로 다른 readiness 조건과 timeout을 가져야 한다.

검증:
- 3개 이상의 strategy를 같은 차트에 순차 추가하고 각 entity id를 수집한다.
- 각 entity id별 `reportData.performance.all.totalTrades`와 `profitFactor`를 조회한다.
- 대상 entity id별 CSV export가 올바른 strategy명 파일로 저장되는지 확인한다.
- `setSymbol('BINANCE:BTCUSDT.P')`가 10초 timeout 없이 `chart_ready=true`를 반환하는지 확인한다.
- confirmation dialog가 남아 있지 않은지 `ui-state` 또는 dialog scan으로 검증한다.

## 우선순위 작업 순서

1. TVC-002: `bottomWidgetBar` adapter 구현
2. TVC-001: Windows Store/AppX launch path 탐지 수정
3. TVC-009: Strategy 추가/결과 추출/CSV 다운로드 tool 보강
4. TVC-010: 여러 strategy 조작과 readiness polling 보강
5. TVC-004: CLI process exit 안정화
6. TVC-006: replay stop idempotent 처리
7. TVC-003: alertService optional capability 정리
8. TVC-005: E2E drawing test 안정화
9. TVC-008: dependency audit fix

완료:
- TVC-007: TradingView Desktop 3.2.0.7916 업데이트 후 전체 재검증

## 2026-06-12 구현 반영

이번 수정으로 다음 항목을 코드에 반영했다.

- TVC-004: CLI router에서 즉시 `process.exit()`를 제거하고 handler 종료 후 CDP `disconnect()`를 호출하도록 수정했다. Windows/Node 24.13.1에서 `npm run test:unit` 통과.
- TVC-010: `normalizeSymbol()`, `symbolsMatch()`, `waitUntil()`을 추가하고 `waitForChartReady()`를 internal chart API 우선으로 수정했다. 실검증에서 `setSymbol('BINANCE:BTCUSDT.P')`와 `setSymbol('KRX_DLY:000210')`가 모두 `chart_ready=true`를 반환했다.
- TVC-002: `ui panel strategy-tester open/close`가 실제 Strategy Tester DOM 상태를 재검증하도록 수정했다. 실검증에서 close 후 `actual_open=false`, `ui-state.strategy_tester.open=false` 확인.
- TVC-009: strategy selector/result parser를 `isTVScriptStrategy`, `StrategyScript`, `reportData`, `ordersData` 기준으로 교체했다. `data list-strategies`, `data strategy`, `data trades`, `data equity`를 기존 단일 strategy에서 실검증했다.
- TVC-009: `data export-trades` CLI와 `data_export_trades_csv` MCP tool을 추가했다. 실검증에서 `C:\Users\YCJ\Downloads\BB.ALL.krx.RSI.4.TRADE.9.55_KRX_000210_2026-06-12_ba2d2.csv` 생성, 42 rows / 15 columns 확인.
- TVC-009/TVC-010: `pine.smartCompile()`이 `title="Add to chart"` icon button, `Update on chart`, confirmation dialog의 `Save and add to chart`를 처리하고 새 study 추가 및 strategy `reportData` 준비 여부를 polling하도록 수정했다.
- TVC-009/TVC-010: 사용자 승인 후 2단계 add flow를 실검증했다. Donchian strategy가 새 entity `h6VbUu`로 추가되었고, `Save and add to chart` confirmation 클릭, `report_ready=true`, `trades_count=17`, `profitFactor=0.6468384479615673`, `netProfit=-150.45870634602937`를 확인했다. 테스트 entity는 제거했다.
- TVC-009/TVC-010: 사용자 요청에 따라 `BINANCE:BTCUSDT.P` 15분봉에서 Donchian strategy를 다시 실검증했다. 새 entity `dksej0` 추가, `strategy_report_ready=true`, `totalTrades=17`, `profitFactor=0.6468384479615673`, `netProfit=-150.45870634602937` 확인. `data strategy/trades/equity`와 CSV export도 성공했고 `C:\Users\YCJ\Downloads\OnlyBit_BTC_Donchian_Breakout_Trail_v0.2_Long_BINANCE_BTCUSDT.P_2026-06-12_45569.csv`가 34 rows / 15 columns로 생성되었다. 테스트 entity는 제거하고 차트는 `KRX_DLY:000210` 1D로 복구했다.
- TVC-009/TVC-010: 다른 전략으로 `OnlyBit BTC Keltner Squeeze Trend Ride v0.2 Long`도 `BINANCE:BTCUSDT.P` 15분봉에서 검증했다. 새 entity `9v9tWX` 추가, `Save and add to chart` confirmation 클릭, `strategy_report_ready=true`, `totalTrades=7`, `profitFactor=0.5101648177188141`, `netProfit=-91.51805801845725` 확인. `data strategy/trades/equity`와 CSV export도 성공했고 `C:\Users\YCJ\Downloads\OnlyBit_BTC_Keltner_Squeeze_Trend_Ride_v0.2_Long_BINANCE_BTCUSDT.P_2026-06-12_9405c.csv`가 14 rows / 15 columns로 생성되었다. 테스트 entity는 제거하고 차트는 `KRX_DLY:000210` 1D로 복구했다.

남은 제한:
- 같은 scratch script에 여러 source를 연속 주입하면 TradingView가 두 번째부터 새 entity를 추가하지 않고 기존 on-chart script를 `Update on chart`로 갱신할 수 있다. 여러 strategy를 동시에 차트에 올리려면 strategy별 저장 script를 분리해야 한다.
- 여러 strategy가 동시에 있을 때 특정 strategy를 Strategy Tester UI에서 활성화하는 단계는 아직 완전 자동화하지 않았다. `data strategy/trades/equity`는 `entity_id`, `strategy_name`, `latest`, `active` selector를 받지만, CSV export는 현재 UI의 활성 Strategy Tester trade list를 내려받는다.
- Deep Backtesting은 이번 15분봉 검증에서 UI에 `Deep Backtesting` 토글/버튼이 노출되지 않아 자동화 검증하지 못했다. 현재 구현은 일반 Strategy Tester 결과 읽기와 CSV export까지 검증된 상태이며, 딥백테스트는 mode 감지, range 설정, 장시간 계산 완료 polling, 결과 mode 태깅을 별도 단계로 추가해야 한다.

## 권장 수정 원칙

- TradingView internal API path를 각 feature 파일에 흩뿌리지 말고 adapter 계층에서 feature-detect한다.
- tool 응답은 실제 상태 재검증 후 success를 반환한다. 호출만 성공하고 상태 변화가 없으면 warning 또는 error로 처리한다.
- DOM selector fallback은 언어에 의존하는 text보다 `data-name`, role, aria, 구조 탐색 순서로 둔다.
- 모든 mutating tool은 가능한 한 idempotent하게 만든다.
- E2E는 실제 계정/차트 상태를 오염시키지 않도록 테스트가 만든 entity ID를 추적하고 cleanup한다.
