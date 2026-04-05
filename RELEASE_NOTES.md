# Release Notes - 嗨科技商家對帳與提領系統

**產品名稱**：Merchant Reconciliation & Payout System
**產品類型**：B2B2C 電商平台商家帳務系統
**技術棧**：Next.js 16 (App Router) + Prisma 7 + PostgreSQL + TypeScript + Tailwind CSS + shadcn/ui

---

## 產品需求摘要 (PRD Summary)

### 背景
Hi5 類型的 B2B2C 平台需要一套以 **append-only ledger** 為核心的商家對帳與提領系統，解決以下問題：
- 商家只看到總額，看不到拆解明細
- 退款後無法精確追扣
- 提領失敗後無法自動回補
- 爭議案件只能人工備註，無法真正凍結資金
- 平台財務需要用 Excel 補單與追帳

### 核心業務規則
| 規則 | 內容 |
|------|------|
| 結算模式 | 自主提領，非自動撥款 |
| 鑑賞期 | 物流 Delivered + 7 天 |
| 結算單位 | Order Item Level（非 Order Level） |
| 平台抽成 | 基於折扣後成交價計算 |
| 運費歸屬 | 100% 歸商家 |
| 稅務 | 所有金額同時顯示含稅/未稅 |
| 提領時段 | 每日 00:00~03:00 禁止申請 |
| 爭議凍結 | 僅凍結爭議金額，不可全額凍結 |
| 退款規則 | 抽成按比例退、金流費不退、活動成本按比例收回 |
| 已提領退款 | 可形成負餘額，暫停提領直到補足 |
| 銀行帳號 | 變更需平台財務審核 |
| Reserve | 風險分級（low/medium/high），人工設定 |

### 使用者角色
1. **商家主帳號** - 查看帳務、發起提領、管理爭議、下載對帳單
2. **平台財務** - 結算批次、提領管理、手動調整、Reserve 設定、銀行帳號審核
3. **超級管理員** - 覆寫狀態、凍結 wallet、代理登入

### 不可踩的紅線
1. 不可直接修改 wallet balance 當真相（必須走 ledger）
2. 不可只做 order-level 對帳（必須 item-level）
3. 不可人工改資料不留痕（必須 audit log）
4. 不可提領失敗不回補 wallet
5. 不可 dispute 全額凍結整單（僅凍結爭議金額）
6. 不可缺少 idempotency
7. 不可將 RBAC 寫死不可擴充

---

## 系統架構

### 資料模型
```
Append-Only Ledger (Single Source of Truth)
├── WalletLedgerEntry (每筆帳務事件)
│   ├── walletId + bucket (PENDING/AVAILABLE/RESERVED/IN_TRANSIT)
│   ├── amount (正=credit, 負=debit)
│   ├── balanceAfter (running balance, O(1) 查詢)
│   ├── 三欄金額 (amountTaxIncl / amountTaxExcl / taxAmount)
│   ├── entryType (17 種 ledger 事件類型)
│   ├── referenceType + referenceId (多態連結)
│   └── idempotencyKey (unique, 防重複)
├── MerchantWallet (1:1 with Merchant)
└── WalletBalanceSnapshot (效能快取，非真相來源)
```

### 可提領餘額公式
```
可提領餘額 = Available Bucket Balance - Reserve - 爭議凍結 - 未完成負向調整
```

### 服務架構
```
Server Actions (mutations) → Services (business logic) → Ledger (append-only)
                                                        → Audit (logging)
                                                        → Idempotency (dedup)
Route Handlers (webhooks, cron, exports)
```

### 狀態機
- **Settlement**: 12 個狀態 (pending_payment → ... → closed)
- **Payout**: 6 個狀態 (requested → success/failed → returned)
- **Dispute**: 8 個狀態 (opened → ... → closed)
- **銀行帳號變更**: 4 個狀態 (pending_review → effective)

### 目錄結構
```
src/
├── app/
│   ├── (auth)/login/           # 登入
│   ├── (merchant)/             # 商家入口 (6 個頁面)
│   ├── platform/               # 平台財務入口 (9 個頁面)
│   ├── admin/                  # 超級管理員 (2 個頁面)
│   └── api/                    # Webhooks, Cron, Auth, Export
├── server/
│   ├── services/               # 8 個核心服務
│   ├── actions/                # Server Actions
│   └── queries/                # 讀取函式
├── lib/
│   ├── auth.ts + auth-guard.ts # 認證授權
│   ├── money.ts + tax.ts       # 金額計算
│   ├── state-machines/         # 4 個狀態機
│   └── validators/             # Zod schemas
└── components/                 # UI 元件
```

---

## 資料庫 Schema (30+ 表)

| 分類 | 表名 | 說明 |
|------|------|------|
| 認證 | users, roles, permissions, user_roles, role_permissions | RBAC 架構 |
| 商家 | merchants, merchant_stores | 商家與店鋪 |
| 銀行 | merchant_bank_accounts, merchant_bank_account_change_requests | 銀行帳號管理 |
| 風控 | merchant_risk_profiles, merchant_reserve_rules | 風險等級與保留金 |
| 錢包 | merchant_wallets, wallet_ledger_entries, wallet_balance_snapshots | Ledger 核心 |
| 訂單 | orders, order_items, shipments | 訂單資料 |
| 結算 | settlement_items, settlement_batches, settlement_adjustments | 結算管理 |
| 提領 | payout_requests, payout_batches, payout_batch_items, payout_failures | 提領流程 |
| 退款 | refunds, refund_items | 退款追扣 |
| 爭議 | dispute_cases, dispute_evidences, dispute_freezes | 爭議管理 |
| 對帳 | monthly_statements, monthly_statement_items | 月度對帳單 |
| 稽核 | audit_logs, idempotency_keys | 稽核與防重 |

---

## 實作階段規劃

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 1 | 基礎建設：專案架構、Schema、Services、Auth、UI 骨架 | ✅ 完成 |
| Phase 2 | 核心 Ledger + 結算流程 + 對帳明細 UI | ✅ 完成 |
| Phase 3 | 提領功能（申請、批次、失敗回補、銀行帳號） | ✅ 完成 |
| Phase 4 | 退款 + 爭議 + 手動調整（按比例計算、負餘額、部分凍結） | ✅ 完成 |
| Phase 5 | Reserve + 月度對帳單 + 規則設定 + 平台管理 | ✅ 完成 |
| Phase 6 | Admin 功能 + Middleware + Error Pages | ✅ 完成 |

---

## 版本紀錄

### v0.1.0 - Phase 1 基礎建設 (2026-04-05)

**新增功能：**

#### 專案基礎
- 初始化 Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui 專案
- 設定 Prisma 7 multi-file schema（12 個 .prisma 檔案）
- 建立 30+ 資料表定義，涵蓋完整帳務生命週期
- 所有金額欄位使用 `Decimal(18,4)` 精度，每筆金額存三欄（含稅/未稅/稅額）

#### 核心服務 (8 個)
- **LedgerService** - Append-only ledger 引擎
  - `createEntry()` 支援 idempotency check + running balance 計算
  - `getBalances()` O(4) 查詢取得四個 bucket 餘額
  - `recalculateBalances()` 從零加總（稽核用）
- **SettlementService** - 每日批次結算
  - 鑑賞期 7 天後自動釋放
  - 抽成基於折扣後價格計算
  - 運費 100% 歸商家
  - 支援 Reserve 自動扣留
- **PayoutService** - 提領管理
  - 驗證邏輯：禁提時段、餘額、凍結、負餘額
  - 失敗自動回補 wallet (IN_TRANSIT → AVAILABLE)
- **RefundService** - 退款處理
  - 抽成按比例退、金流費不退、活動成本按比例收回
  - 已提領後退款：自動偵測負餘額，暫停提領
- **DisputeService** - 爭議管理
  - 僅凍結爭議金額（非全單凍結）
  - 支援解凍（商家勝訴）/ 扣回（商家敗訴）
- **ReserveService** - 風險保留金 hold/release
- **AuditService** - 全操作稽核紀錄
- **IdempotencyService** - 防重複處理（TTL 24 小時）

#### 認證授權
- NextAuth v5 + Credentials Provider + JWT Strategy
- 5 個角色 + 21 個權限碼，完整 RBAC seed
- `requireRole()` / `requirePermission()` / `requireMerchant()` 三層守衛
- Layout 層級角色檢查（商家/財務/管理員各自獨立）

#### UI 框架
- 三個入口 Layout + Sidebar（商家後台、平台財務後台、超級管理員）
- 21 個路由頁面（含 placeholder）
- 共用元件：
  - `DataTable` - TanStack Table 封裝（分頁、排序、篩選）
  - `AmountDisplay` - 含稅/未稅雙顯示（Tooltip 模式）
  - `StateBadge` - 狀態標籤（依狀態自動配色）
  - `WalletSummaryCard` - 四 bucket 摘要卡片
  - `LedgerTimeline` - Ledger 事件時間軸（credit/debit 配色）

#### 工具函式
- `money.ts` - Decimal.js 封裝，ROUND_HALF_UP，禁用 JS number
- `tax.ts` - 含稅/未稅互轉，預設 5% VAT
- 4 個狀態機（Settlement 12 態、Payout 6 態、Dispute 8 態、BankChange 4 態）
- Zod validation schemas

#### Seed 資料
- 2 個測試商家 + 店鋪 + Wallet + 銀行帳號 + 風險檔案
- 4 個測試帳號（admin / finance / merchant-a / merchant-b）
- 完整 Role-Permission 對照表

**技術決策：**
- 金額運算：`decimal.js` + `Decimal(18,4)`
- 並發控制：Idempotency key (unique constraint)
- Schema 管理：Prisma multi-file schema（12 檔）
- 狀態機：純 TypeScript 函式（輕量、可測試）

**Build 狀態：** ✅ 通過（0 errors, 0 warnings）

---

### v0.2.0 - Phase 2 核心 Ledger + 結算流程 (2026-04-05)

**新增功能：**

#### Server-side Queries
- **wallet.queries.ts** - Wallet 餘額查詢
  - `getWalletBalances()` - 從 ledger 推導四個 bucket 即時餘額
  - `getWalletDashboardData()` - Dashboard 用：月度收入/扣款/淨入帳
  - `getRecentLedgerEntries()` - 最近帳務事件
  - `getAllMerchantWallets()` - 平台端所有商家 wallet 列表（含搜尋分頁）
- **reconciliation.queries.ts** - 對帳明細查詢
  - `getReconciliationList()` - 可篩選列表（狀態、訂單號、SKU、店鋪、日期）
  - `getReconciliationDetail()` - 詳情頁完整資料（含 ledger 事件流、關聯退款、爭議、稽核紀錄）

#### API Endpoints
- **POST /api/cron/settle** - 每日結算批次 cron
  - CRON_SECRET Bearer token 驗證
  - 自動找出鑑賞期到期的 settlement items
  - 批次建立 ledger entries（APPRECIATION_RELEASE + RESERVE_HOLD）
- **POST /api/webhooks/payment** - 付款成功 webhook
  - Idempotent（idempotencyKey 防重）
  - 自動建立 order + order_items + settlement_items
  - 抽成基於折扣後含稅價計算
  - 三欄金額（含稅/未稅/稅額）全自動計算
- **POST /api/webhooks/logistics** - 物流狀態 webhook
  - 處理 shipped / delivered 事件
  - Delivered 後自動設定 `appreciationEndsAt = deliveredAt + 7 天`
  - 狀態轉換：PAID → SHIPPED → IN_APPRECIATION_PERIOD

#### 商家對帳明細列表頁（完整實作）
- 支援篩選：訂單編號、SKU、狀態、日期區間
- 每列顯示：訂單號、商品名、SKU、店鋪、狀態標籤、商品金額（含稅/未稅）、抽成、商家淨額、付款/結算時間
- 伺服器端分頁 + URL search params 保存篩選狀態
- 可點擊訂單號進入詳情頁

#### 對帳明細詳情頁
- 四大區塊：訂單資訊 / 金額計算 / 時間線 / 關聯退款
- **金額計算公式視覺化**：商品金額 → 抽成 → 運費 → 活動成本 → Reserve → 商家淨額
- **Ledger 事件流**：以時間軸顯示所有 ledger entries（credit 綠色 / debit 紅色），含 running balance
- 關聯爭議案件列表 + 狀態標籤
- 稽核紀錄列表

#### Dashboard 即時數據整合
- Wallet 四 bucket 即時餘額（從 ledger 推導）
- 本月總收入 / 總扣款 / 淨入帳（從 ledger aggregate 計算）
- 負餘額暫停提領警示
- Wallet 凍結警示
- 最近 10 筆帳務事件時間軸

**技術改進：**
- 建立 `settlement-status.ts` 客戶端安全的狀態常量（避免 client component 引入 Prisma node 模組）
- Webhook handlers 全面支援 idempotency
- 結算 cron 採 cursor-based pagination 處理大量資料

**Build 狀態：** ✅ 通過（25 routes, 0 errors）

---

### v0.3.0 - Phase 3 提領功能 (2026-04-05)

**新增功能：**

#### Server Actions (寫入操作)
- **payout.actions.ts** - 提領申請
  - `requestPayout()` - 完整驗證（禁提時段、餘額檢查、凍結狀態、負餘額）+ 建立 ledger entries (AVAILABLE → IN_TRANSIT)
- **payout-batch.actions.ts** - 平台批次管理
  - `createPayoutBatch()` - 從所有 REQUESTED 申請建立批次，更新狀態為 QUEUED
  - `importBankResponse()` - 匯入銀行回檔，成功/失敗分別處理（SUCCESS: 扣 IN_TRANSIT / FAILED: 退回 AVAILABLE）
- **bank-account.actions.ts** - 銀行帳號
  - `requestBankAccountChange()` - 商家提交變更申請
  - `approveBankAccountChange()` - 財務核准（停用舊帳號 + 建立新帳號 + 生效）
  - `rejectBankAccountChange()` - 財務拒絕（含拒絕原因）

#### Payout Queries
- `getMerchantPayouts()` - 商家提領紀錄（含失敗原因、批次號）
- `getPayoutDetail()` - 單筆提領詳情
- `getMerchantBankAccounts()` / `getMerchantBankChangeRequests()` - 銀行帳號查詢
- `getPendingPayoutRequests()` - 平台端待處理提領
- `getPayoutBatches()` - 提領批次列表
- `getPendingBankChangeRequests()` - 待審核銀行帳號變更

#### 商家提領頁面（完整實作）
- **可提領餘額卡片** - 即時顯示 available balance + 凍結/暫停警示
- **提領申請表單** - 金額輸入（支援全額按鈕）+ 銀行帳號下拉選擇 + 即時驗證
- **提領紀錄表格** - 申請編號、金額、狀態標籤、銀行快照、批次號、時間、失敗原因

#### 商家銀行帳號管理（完整實作）
- **目前生效帳號** - 顯示銀行名稱、帳號、戶名、生效狀態
- **帳號變更申請表單** - 6 欄位（銀行代碼/名稱、分行代碼/名稱、帳號、戶名）
- **變更歷史** - 狀態標籤（審核中/已核准/已拒絕/已生效）+ 拒絕原因

#### 平台提領批次管理（完整實作）
- **待處理提領數量** - 即時統計
- **一鍵建立批次** - 將所有 REQUESTED 打包為批次
- **批次列表表格** - 批次號、狀態、筆數、總金額、成功/失敗數、建立時間

#### 平台銀行帳號審核（完整實作）
- **待審核列表** - 商家名稱、統編、銀行資訊完整顯示
- **核准/拒絕操作** - 核准一鍵生效，拒絕需填寫原因

#### API Endpoints
- **POST /api/cron/payout** - 每日提領批次 cron（自動建立批次）

**業務邏輯覆蓋：**
- ✅ 商家可對 available balance 發起提領
- ✅ 每日 00:00~03:00 禁止提領申請
- ✅ 提領失敗自動退回 wallet (IN_TRANSIT → AVAILABLE)
- ✅ 失敗原因保留 + 回補紀錄
- ✅ 銀行帳號不可直接變更，需提交申請 + 財務審核
- ✅ 負餘額暫停提領
- ✅ Wallet 凍結阻止提領

**Build 狀態：** ✅ 通過（26 routes, 0 errors）

---

### v0.4.0 - Phase 4 退款 + 爭議 + 手動調整 (2026-04-05)

**新增功能：**

#### 退款系統（完整實作）
- **RefundService** 按比例計算邏輯已整合至 Server Actions
  - `processRefund()` - 支援全額/部分退款
  - 自動計算：抽成按比例退、金流費不退、活動成本按比例收回
  - 已提領後退款：自動偵測負餘額 → 設定 `payoutSuspended` 暫停提領
  - Settlement item 狀態自動更新為 REFUNDED / PARTIALLY_REFUNDED
- **POST /api/webhooks/refund** - 退款 webhook（含 idempotency）
  - 接收退款事件，自動建立 refund + refund_items
  - 產生 ledger entries：REFUND_DEBIT + REFUND_COMMISSION_RETURN + REFUND_CAMPAIGN_RECOVERY

#### 爭議系統（完整實作）
- **Server Actions (5 個)**：
  - `createDisputeCase()` - 建立爭議案件
  - `freezeDisputeAmount()` - **僅凍結爭議金額**（AVAILABLE → RESERVED）
  - `resolveDispute()` - 解除爭議（RESERVED → AVAILABLE 解凍）
  - `rejectDispute()` - 駁回爭議（從 RESERVED 永久扣回）
  - `submitDisputeEvidence()` - 商家補件
- **商家爭議案件中心** - 進行中案件統計、案件列表（編號/狀態/金額/凍結狀態）、補件操作
- **平台爭議管理** - 全案件列表（含商家名稱）、凍結/解除/扣回操作（含處理結果輸入）

#### 手動調整單（完整實作）
- **createAdjustment()** Server Action
  - 支援 6 種調整類型：補發、扣回、客訴補償、帳差修正、稅務調整、系統修正
  - 支援貸方（給商家）/ 借方（從商家扣）
  - 自動產生 ledger entry (MANUAL_ADJUSTMENT_CREDIT / DEBIT)
- **平台調整單管理頁** - 建立表單（商家選擇 + 類型 + 方向 + 金額 + 原因）+ 歷史列表

#### Dispute Queries
- `getMerchantDisputes()` - 商家爭議列表（含凍結狀態、近期補件）
- `getDisputeDetail()` - 單筆爭議詳情
- `getAllDisputes()` - 平台端全部爭議（可篩選狀態/商家/關鍵字）

**業務邏輯覆蓋：**
- ✅ 部分退款 / 全額退款按比例計算
- ✅ 抽成按比例退、金流費不退、活動成本按比例收回
- ✅ 已提領後退款形成負餘額 → 暫停提領
- ✅ dispute 僅凍結爭議金額（非全單凍結）
- ✅ 爭議解除 → 解凍回 AVAILABLE
- ✅ 爭議駁回 → 從 RESERVED 永久扣回
- ✅ 手動調整單留痕（audit log）
- ✅ 退款 webhook 冪等處理

**Build 狀態：** ✅ 通過（27 routes, 0 errors）

---

### v0.5.0 - Phase 5 Reserve + 月度對帳單 + 規則設定 (2026-04-05)

**新增功能：**

#### Reserve 管理（完整實作）
- **Server Actions**：
  - `setMerchantRiskLevel()` - 設定商家風險等級 (LOW/MEDIUM/HIGH)
  - `setReserveRule()` - 設定 Reserve 比例與保留天數
  - `releaseReserve()` - 手動釋放保留金（RESERVED → AVAILABLE + ledger entries）
- **平台 Reserve 管理頁** - 商家列表 + 風險等級標籤 + Reserve 設定面板
  - 設定風險等級（下拉選擇）
  - 設定 Reserve 比例（%）與保留天數
  - 手動釋放 Reserve 金額

#### 月度對帳單（完整實作）
- **StatementService** (`generateMonthlyStatement()`)
  - 計算期初/期末餘額（從 ledger 推導）
  - 彙總月度收入/扣款/提領
  - 建立明細項（每筆 ledger entry 對應一行）
- **XLSX 匯出 API** (`GET /api/export/statement/[id]?format=xlsx`)
  - ExcelJS 產生：標題 + 商家資訊 + 摘要 + 明細表格
  - 自動下載 `statement_YYYY_MM.xlsx`
- **商家對帳單頁面** - 月份列表 + 期初/期末/收入/扣款/提領 + XLSX 下載按鈕
- **對帳單產生按鈕** - 一鍵產生上月對帳單
- **POST /api/cron/snapshot** - 批次產生所有商家的月度對帳單

#### 平台商家總帳管理（完整實作）
- 所有商家 wallet 概覽表格
- 四 bucket 即時餘額（待清款/可提領/Reserve/提領中）
- 風險等級標籤、凍結/停提領狀態標籤

#### 平台結算批次管理（完整實作）
- 待結算項目數量統計
- 一鍵執行結算批次（呼叫 `/api/cron/settle`）
- 批次歷史表格（批次號/狀態/筆數/金額/成功失敗數/觸發者/時間）

#### 平台規則設定頁（完整實作）
- 6 大類規則視覺化展示：
  - 結算規則（鑑賞期、批次大小、抽成基礎、運費歸屬）
  - 提領規則（禁提時段、上限、模式）
  - 退款規則（抽成退還/金流費/活動成本/負餘額）
  - 爭議規則（凍結範圍）
  - 稅務規則（稅率、顯示方式）
  - 系統規則（Idempotency TTL）

**Build 狀態：** ✅ 通過（30 routes, 0 errors）

---

### v0.6.0 - Phase 6 Admin 功能 + 系統完善 (2026-04-05)

**新增功能：**

#### 超級管理員覆寫功能（完整實作）
- **Server Actions (4 個)**：
  - `overrideSettlementStatus()` - 強制覆寫結算項目狀態
  - `overridePayoutStatus()` - 強制覆寫提領狀態（失敗時自動退回 wallet）
  - `toggleWalletFreeze()` - 凍結/解凍商家錢包（含原因）
  - `forceAdjustment()` - 強制建立調整單（繞過正常流程，但留稽核紀錄）
- **管理員覆寫頁面** - 商家列表 + 凍結狀態 + 一鍵凍結/解凍 + 強制補發/扣回

#### 代理登入（完整實作）
- **代理登入頁面** - 商家列表 + 帳號列表 + 代理登入按鈕
- 所有代理登入操作留稽核紀錄

#### 平台 Dashboard 即時數據升級
- 6 大即時指標：總商家數、待處理提領、活躍爭議、待結算項目、凍結錢包、待審帳號變更
- 最近 10 筆操作紀錄（audit log timeline）

#### Middleware 路由守衛
- 全域認證中間件（未登入自動重導至 `/login`）
- 公開路由白名單：`/login`、`/api/webhooks`、`/api/auth`

#### Error Pages
- `404 Not Found` 自訂頁面
- `Error` 自訂頁面（含錯誤訊息 + 重試按鈕）

**PRD 驗收標準覆蓋表：**

| # | 驗收標準 | 狀態 |
|---|---------|------|
| 1 | 可完成正常訂單結算並在 7 天後轉可提領 | ✅ |
| 2 | 可處理多商家訂單拆分 | ✅ |
| 3 | 可處理部分退款 / 全額退款 | ✅ |
| 4 | 可處理爭議部分凍結 | ✅ |
| 5 | 可完成提領申請與每日批次 | ✅ |
| 6 | 可在提領失敗後自動回補 wallet | ✅ |
| 7 | 可支援已提領後退款追扣與負餘額 | ✅ |
| 8 | 可建立手動調整單 | ✅ |
| 9 | 可審核銀行帳號變更 | ✅ |
| 10 | 可生成月度正式對帳單 XLSX | ✅ |
| 11 | 所有關鍵流程具 audit log 與 idempotency | ✅ |
| 12 | UI 可完整展示商家與財務端主要流程 | ✅ |

**不可踩的紅線遵守表：**

| # | 紅線 | 遵守方式 |
|---|------|---------|
| 1 | 不可直接修改 wallet balance 當真相 | Append-only ledger，餘額由 entries 推導 |
| 2 | 不可只做 order-level 對帳 | 下沉到 order item level (SettlementItem 1:1 OrderItem) |
| 3 | 不可人工改資料不留痕 | 所有操作走 AuditService.log() |
| 4 | 不可提領失敗不回補 wallet | PayoutService.handleFailure() 自動 IN_TRANSIT → AVAILABLE |
| 5 | 不可 dispute 全額凍結整單 | DisputeService 僅凍結 disputeAmountTaxIncl |
| 6 | 不可缺少 audit log | 全部 Server Actions 含 AuditService.log() |
| 7 | 不可缺少 idempotency | Webhook + Cron 全面支援 idempotencyKey |
| 8 | 不可將 RBAC 寫死不可擴充 | 5 角色 + 21 權限碼，seed 到 DB，可動態調整 |
| 9 | 不可只做 UI 不做真實資料結構與流程 | 完整 30+ 表 Schema + 8 個 Service + Ledger 引擎 |

**Build 狀態：** ✅ 通過（30 routes + Middleware, 0 errors）

---

## MVP 完成總結

### 系統規模
- **30 routes**（17 頁面 + 8 API + 4 cron/webhook + 1 export）
- **30+ 資料表**（12 個 Prisma schema 檔案）
- **8 個核心 Service**（Ledger, Settlement, Payout, Refund, Dispute, Reserve, Audit, Idempotency）
- **12 個 Server Actions**（覆蓋所有寫入操作）
- **6 個 Queries 模組**（覆蓋所有讀取操作）
- **4 個狀態機**（Settlement 12 態, Payout 6 態, Dispute 8 態, BankChange 4 態）
- **全域 Middleware** 認證守衛
- **完整 RBAC** 5 角色 + 21 權限碼

### 測試帳號
| 帳號 | 密碼 | 角色 |
|------|------|------|
| admin@hi5.com | password123 | 超級管理員 |
| finance@hi5.com | password123 | 平台財務 |
| owner@merchant-a.com | password123 | 商家A負責人 |
| owner@merchant-b.com | password123 | 商家B負責人 |

---

*MVP 全 6 Phase 完成。本文件可作為後續迭代與維運的基準參考。*
