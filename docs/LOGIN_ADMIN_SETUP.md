# 安護交班｜手機帳號、管理員建檔與首次密碼設定

本專案是獨立的 GitHub Pages + Supabase Auth + PostgreSQL 交班系統。

## 登入方式

- **登入帳號：員工手機門號**（輸入 `09xxxxxxxx`，網站自動轉換為 `+8869xxxxxxxx`）。
- **登入密碼：由管理員建檔時取得的一次性隨機初始密碼**，員工首次登入必須更改成自己的密碼。
- **沒有員工自行註冊入口**，也不需要在每次登入時輸入簡訊驗證碼。
- 出於長照個案安全及個資保護，**不使用身分證字號作固定密碼或初始密碼**。系統不蒐集身分證號。
- 前端不儲存初始密碼；管理員建檔成功後只顯示一次，必須以安全方式交給員工，禁止群組公開傳送。

## 資料庫與權限

- `profiles.must_change_password` 預設 true。只有 Supabase Auth 成功更改帳號密碼後，資料庫觸發器才會解除此限制。
- `is_active()`、`is_admin()` 都要求帳號啟用、已確認，以及密碼設定完成。未更改初始密碼者無法看任何個案。
- 居服員及居督只可閱覽已指派個案；最高管理員可核准、停用、調整角色及指派。
- `admin-create-staff` Edge Function 必須帶有效管理員登入 JWT，伺服器再次驗證角色及狀態；`SUPABASE_SERVICE_ROLE_KEY` 僅位於 Supabase Function 環境，絕不出現在 GitHub Pages。
- Edge Function 僅建立居服員／居督帳號，提升管理員角色必須由既有管理員在後台操作。

## 由管理員新增居服員

1. 管理員登入 `https://biubiusmile.github.io/home-care-handover/`。
2. 進入「管理員後台」→「建立員工帳號」。
3. 輸入員工姓名、台灣手機門號，選擇居服員或居督。
4. 點「建立員工帳號」，網站呼叫 Supabase Edge Function，伺服器產生隨機初始密碼並建立 Auth 使用者（`phone_confirm=true`）。
5. 初始密碼只顯示一次。確認本人身分後，**私下**將帳號與初始密碼交付員工。
6. 員工使用手機號碼與初始密碼登入，完成「首次設定個人密碼」，系統才會開放已指派個案。

> 管理員建立帳號時的 `phone_confirm=true` 代表管理員確認員工手機號碼，不等於簡訊實際驗證手機持有者。要處理真實長照資料，需補充正式身分驗證與 MFA 政策。

## 系統建立第一位管理員（只操作一次）

因資料庫目前沒有既有管理員，不能讓匿名網站自行註冊為管理員。

1. 開啟 [Supabase Authentication → Users](https://supabase.com/dashboard/project/zlkulrvbbjhxvimfhwjy/auth/users)。
2. 使用 Dashboard 的「Add user / Create new user」建立**臨時初始化帳號**（Email + 由你自行管理的臨時密碼），確認該 Email 可登入。這是系統初始化用途，不是居服員登入方式。
3. 回到 [SQL Editor](https://supabase.com/dashboard/project/zlkulrvbbjhxvimfhwjy/sql/new)，將下列範例 Email 改成你的臨時帳號再執行：

```sql
update public.profiles
set display_name='系統初始管理員', role='admin', active=true
where id=(select id from auth.users
          where email='your-admin@example.com'
            and email_confirmed_at is not null)
returning id, role, active, must_change_password;
```

4. **必須有 1 列回傳**；若沒有，先確認 Dashboard 的臨時帳號是否已建立及驗證。
5. 開啟一次性初始化入口：`https://biubiusmile.github.io/home-care-handover/bootstrap-admin.html`，用該臨時 Email＋密碼登入。
6. 網頁會返回正式首頁並要求你變更初始密碼；完成後就能進入「管理員後台」。
7. 在管理員後台建立自己的**手機帳號**，登入後更改初始密碼，然後由第一位管理員在後台把手機帳號角色改為「管理員」。
8. 確認新手機管理員可登入後，停用臨時 Email 管理員，並從 GitHub 刪除 `bootstrap-admin.html`。留至少一位啟用中的管理員，不要刪除唯一管理員。

## 停用一般使用者自行註冊（必要）

在 Supabase Dashboard → **Authentication → Sign In / Providers**，將 **Allow new users to sign up** 改成 **OFF** 並儲存。此選項屬於 Supabase 後台設定，單純隱藏網站「註冊」按鈕是不夠的。

管理員經 `admin-create-staff` 的伺服器端管理權限建立帳號，不依賴公開自助註冊。**建議在初始化第一位管理員後立即關閉此選項**。

## Supabase Phone Provider

到 [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/zlkulrvbbjhxvimfhwjy/auth/providers) 啟用 Phone 登入方式。**手機＋密碼**與「每次輸入簡訊 OTP」是不同流程；後台建立並由管理員確認的門號，登入時不會主動要求傳簡訊。如 Supabase 畫面要求 SMS Provider，再依介面提示處理；未實測前不要直接用真實個案資料。

## 上線前必須完成

長照交班可能涉及健康與其他敏感個資。網站目前屬研究測試版本，尚未完成資安審查、MFA、完整管理員稽核、登入風險防護、備份策略、帳號救援、換號與離職撤權流程。**只能先用虛構測試個案資料。**

不要將真實身分證字號、私人密碼、Service Role 金鑰、OTP 或資料庫密碼放在 GitHub 或傳給其他人。
