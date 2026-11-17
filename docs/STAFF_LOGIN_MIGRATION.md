# 安護交班｜員工手機登入改為內部 Email／Password（免 Twilio）

## 完成狀態

網站登入程式、員工新建帳號的 Supabase Edge Function、資料庫手機帳號欄位與管理員轉換面板均已更新。

**注意：既有 15 位居服員／居督在管理員執行轉換前，原帳號仍只有 Phone 身分，無法使用新登入流程。** 這是刻意採用的安全分階段轉換，而不是轉換已完成。

## 為何需要一次性轉換？

Supabase 原生 Phone 登入需要啟用 Phone Provider；專案目前未設定簡訊供應商。員工原本有 Phone 身分與密碼，但無法透過已停用的 Provider 驗證。

新版做法讓使用者仍填手機號碼，例如 `0912345678`，**瀏覽器內部**只把它轉成系統自用登入 Email 格式 `u886912345678@staff-login.chkia.dev`，然後呼叫 Supabase Email／Password 驗證。Email 只作身分識別，居服員不必提供真實 Email，也不會寄信驗證。

- `chkia.dev` 是機構維護的網域；**請勿為 `staff-login.chkia.dev` 設定可讓陌生人收件的 catch-all 信箱。**
- 此方式避免 SMS/Twilio，但 Email 功能仍需在 Supabase Auth 啟用。
- 未來密碼只能由有權限的管理員安全重設；不要向不存在的內部 Email 寄密碼重設信。
- **請到 Supabase → Authentication → Providers 關閉公開註冊／Allow new users to sign up**，避免外人搶先註冊可預測的內部 Email 別名；不要將 `service_role` 金鑰放入公開程式碼。

## 既有員工轉換（管理員必做）

1. 用原本的管理員 **Email／密碼** 登入 [安護交班](https://biubiusmile.github.io/home-care-handover/)，按 Ctrl + F5 更新。
2. 進入「管理員後台 → 帳號與權限管理」下方的「手機帳號登入方式轉換（免簡訊）」。
3. 點「↻ 檢查狀態」。預期顯示共有 15 位，已轉換 0 位、待轉換 15 位；實際以當時狀態為準。
4. 點「先轉換 1 位測試」。後端必須重新驗證管理員的 Supabase Auth JWT、查核有效管理員角色，然後使用 Supabase Admin API 更新該使用者的 Email 身分及確認狀態；**不重設密碼、不新增使用者、不改 User ID**。
5. 請畫面標示的試點員工**在另一個瀏覽器／無痕視窗**，使用原手機與原密碼登入。登入後再確認個案指派與交班紀錄是否正確。
6. 試點測試成功後，回管理員後台點「確認測試後轉換其餘人員」，並再次確認。
7. 點「檢查狀態」，直到所有人顯示已轉換、待轉換 0、問題 0。若出現失敗／衝突，**先停止**，不要刪除或重建舊帳號。

## 新增員工

新版「建立員工帳號」仍輸入姓名、手機號碼、角色及密碼。Supabase Admin API 建立 **Email／Password** 身分，並把手機登入帳號寫入 `profiles.login_phone`；不建立 Phone Auth 身分。既有員工保留原 Phone 身分作為歷史資料，但登入走內部 Email。

## 技術及安全

- 前端映射：`phoneE164(手機)` 去掉 `+` 後，形成 `u8869xxxxxxxx@staff-login.chkia.dev`。
- 後端映射：`staffEmail(normalizePhone(手機))`；必須保持與前端一致。
- 轉換操作：Supabase Edge Function `admin-create-staff` 的 `migration_status` 和 `migrate_logins` 動作；`verify_jwt:true` 且後端查驗已啟用管理員權限。
- 複核登入別名、Email 身分是否已建立以及信箱確認時間；若部分失敗停止並顯示，不允許覆蓋員工已有的其他 Email。
- `profiles.login_phone` 正規化成 `8869xxxxxxxx` 且加上唯一約束；原有 RLS 僅使用者自己及管理員可讀取。
- 原本的 `auth.users.id`、密碼雜湊、個案指派、交班歷史均不由轉換程式修改。
- 公開 GitHub Pages 不包含 `service_role` 或管理員密碼。
- 舊版 Phone Auth 不需啟用，也不需設定 Twilio；請保持 Phone Provider 停用，免得額外啟用 OTP 簡訊流程。

## 驗證限制

前端 JavaScript 與 Supabase Edge Function 已部署。**由於管理員密碼及登入工作階段不會提供給程式工具，實際轉換要由管理員本人從網站按鈕授權。** 未在已登入管理員的真實瀏覽器中驗證第一位員工原密碼前，不宣稱全部員工可正常登入。
