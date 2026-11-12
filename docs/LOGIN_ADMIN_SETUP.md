# 安護交班｜登入與管理員系統設定

本專案為獨立 GitHub Pages 靜態網站，登入與資料處理使用 Supabase Auth + PostgreSQL + RLS。

## 目前完成進度
- `index.html`：正式登入及已核准帳號操作入口（待接 Supabase）。
- `demo.html`：原始虛構資料的交班互動展示版，資料只存在此瀏覽器。
- `portal.js`：登入、申請帳號、登出、管理員、個案指派、交班與已讀確認。
- `config.js`：公開前端設定範本，目前為空白，未啟動正式登入。
- `supabase/schema.sql`：資料表、觸發器、角色、個案授權及 RLS 安全規則。

> **重要：在 Supabase 專案建立、執行 schema.sql、填寫公開連線設定並驗證前，正式登入系統尚未啟用。請勿輸入真實個案資料。**

## 1. 建立 Supabase 專案
1. 到 https://supabase.com/dashboard 建立專用專案，名稱可設為 `home-care-handover`。
2. 在 SQL Editor 開新查詢，執行本專案的 [supabase/schema.sql](supabase/schema.sql)。
3. 到 Authentication > Providers 啟用 Email，建議保留 Email Confirm（電子信箱驗證）。
4. 在 Authentication > URL Configuration 中設定 **Site URL** 為 `https://biubiusmile.github.io/home-care-handover/`，並將 `https://biubiusmile.github.io/home-care-handover/**` 加入 Redirect URLs（依 Supabase 畫面與實際網址調整）。
5. 對外開放註冊前，配置防機器人/寄信速率限制；管理員需先確認身分後才啟用帳號。

## 2. 設定公開金鑰
從 Supabase Project Settings > API Keys 或 Connect 取得：
- Project URL，格式 `https://專案-ref.supabase.co`
- `sb_publishable_...` 金鑰或 legacy `anon` key

編輯 `config.js`，填入：
```js
window.CARE_CONFIG = {
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'your-publishable-or-anon-key'
};
```

**絕對不可將 `sb_secret_...`、`service_role`、資料庫密碼、JWT signing secret 寫入 GitHub、網頁檔案或瀏覽器。**
公開金鑰被看見是正常現象，資料安全必須由 Supabase RLS 決定。

## 3. 建立第一位管理員
1. 設定完成後，從網站入口 `index.html` 選「申請新帳號」註冊。
2. 完成 Email 確認（若啟用）。新帳號預設角色為 `staff`、`active=false`（待審核），目前不可讀取任何個案資訊。
3. 在 **Supabase SQL Editor** 中執行下面的 SQL，將 `YOUR_EMAIL@example.com` 換成自己註冊的管理員信箱：

```sql
update public.profiles
set role = 'admin', active = true
where id = (
  select id from auth.users where email = 'YOUR_EMAIL@example.com'
);
```

4. 重新登入，管理員就會看到「管理員後台」。
5. 建議只有首位管理員使用 SQL Editor 啟用；之後一般帳號由管理員後台核准，不再直接操作 SQL。

## 4. 管理員功能
- 啟用或停用新帳號；角色：管理員 / 居督 / 居服員
- 新增及維護個案，並設定固定照顧重點
- 指派與取消個案服務人員（取消後即失去查閱權）
- 所有交班紀錄僅允許已授權人員讀取和新增，原始紀錄不能從網站覆寫或刪除
- 讀取交班後保存已讀時間，下一筆新紀錄會重新顯示待閱

### 權限原則
- Admin：可讀全部個案，管理個案、帳號、指派
- Supervisor / Staff：只可讀取被指派個案，無法管理帳號
- 未啟用：無任何個案資料存取權
- 原始交班不提供編輯或刪除；如需更正，應新增一筆補充紀錄

## 5. GitHub Pages 設定
Repository > Settings > Pages > Build and deployment：
- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`
- Save

網址：`https://biubiusmile.github.io/home-care-handover/`

## 6. 正式營運前必要工作
此原型尚未通過資訊安全及長照個資合規驗證。若要處理真實個案健康資料，先確認個資蒐集及利用的適法性、授權流程、最低權限、完整稽核、備份及復原、資料保留及刪除政策、離職撤權、帳戶安全、異常通知、管理員操作記錄與系統測試。

目前不包含：可信任的管理員操作稽核、強制 MFA、醫療或長照正式資安驗證、資料備份策略、多機構租戶隔離。**跨機構使用請先建置更嚴格的機構隔離規則。**
