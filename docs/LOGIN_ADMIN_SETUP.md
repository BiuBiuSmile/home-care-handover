# 安護交班｜手機登入與管理員啟用教學

網站：`https://biubiusmile.github.io/home-care-handover/`

本研究系統採 **台灣手機門號＋密碼**，不需要電子信箱。
已上傳 GitHub 的程式為前端畫面，帳號驗證透過 Supabase Auth，所有個案存取由 PostgreSQL RLS 驗證。

## 已完成
- GitHub Pages 網站程式：`index.html`、`portal.js`、`config.js`
- Supabase 專用資料庫：`profiles`、`cases`、`case_assignments`、`handovers`、`case_reads`
- 帳號待審核與管理員授權規則
- 新版手機門號登入、註冊、簡訊驗證碼頁面
- 原展示版在 `demo.html`，與正式帳號資料無關

## 第一步：開啟 Phone 登入及驗證簡訊

1. 開啟 Supabase Dashboard → Authentication → Sign In / Providers。
2. 點選 **Phone**，將 Enable Phone provider 開啟。
3. 設定簡訊供應商（依介面支援清單，例如 Twilio、Vonage、MessageBird 等），填寫由供應商提供的必要資訊。
4. **啟用手機號碼驗證**，不要為了省簡訊而關掉驗證程序；此步驟涉及個案紀錄權限。
5. Save 儲存。簡訊費通常由供應商收取；沒有供應商不會真正發送註冊簡訊。
6. 研究測試也可依 [Supabase 官方測試門號教學](https://supabase.com/docs/guides/auth/testing-auth-flows) 使用測試門號＋固定 OTP，但 Supabase 對託管專案仍要求設定 SMS provider；測試門號**不可用於正式營運**。

官方文件：[Phone login](https://supabase.com/docs/guides/auth/phone-login)／[Password with phone](https://supabase.com/docs/guides/auth/passwords)

## 第二步：註冊第一位帳號

1. 進入網站首頁（`index.html`），選「申請新帳號」。
2. 填寫姓名、台灣手機門號，例如 `0912345678`，以及密碼。
3. 系統會自動將台灣門號轉為國際格式，例如 `+886912345678`。
4. 收到簡訊後輸入驗證碼，完成門號驗證。
5. 新帳號會先是 `staff`、`active=false`，無法讀取任何個案資訊。

## 第三步：開啟第一位管理員

前往 Supabase → SQL Editor，將以下 SQL 中的 **範例門號** 換成「你剛註冊且已驗證」的實際門號（以 `+886` 格式）。不要在 ChatGPT 貼密碼或驗證碼。

```sql
update public.profiles
set role = 'admin', active = true
where id = (
  select id from auth.users
  where phone = '+886912345678'
    and phone_confirmed_at is not null
);
```

執行後，**只要更新 1 列** 才表示成功。若顯示 0 列，先檢查門號格式、註冊是否完成以及簡訊是否驗證。

重新登入網站，會看到「管理員後台」。

## 第四步：管理員功能

- 啟用或停用新帳號；角色：管理員 / 居督 / 居服員。
- 建立／修改個案及固定照顧重點。
- 指派／取消居服員與督導可閱覽的個案。
- 經授權的服務人員可以新增交班、查閱歷史交班、確認已讀。
- 未被指派或未啟用人員不可查閱交班資料。

## 注意事項

- 手機號碼＋密碼 **不等同於免驗證**。首次需確認門號持有者，建議進一步使用 MFA；手機門號可能遭回收或換號。
- 長照個案資料涉及敏感資料，正式使用前必須進行資安、適法性、備份、稽核、帳號復原與離職撤權等完整檢查。
- 目前網頁尚無「忘記密碼／門號更換」完整流程；請先以虛構個案測試。
- 不要把 Twilio Auth Token、Supabase service_role、私密金鑰、資料庫密碼、簡訊驗證碼放到 GitHub 或提供給他人。
- 先不需要再設定電子郵件註冊。Authentication 的 Site URL/Redirect URLs 可保留不動。
