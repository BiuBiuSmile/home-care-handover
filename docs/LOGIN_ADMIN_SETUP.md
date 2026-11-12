# 安護交班｜手機簡訊登入與管理員啟用指南

本專案為 GitHub Pages + Supabase Auth + PostgreSQL。**使用者只需輸入手機號碼，收到簡訊後填寫 OTP 驗證碼，不需任何密碼或 Email。**

## 使用者登入方式
1. 前往 `https://biubiusmile.github.io/home-care-handover/`
2. 輸入台灣手機門號，例如 `0912345678`，系統轉為 `+886912345678`
3. 點「傳送簡訊驗證碼」，收到 SMS 後輸入驗證碼
4. 已核准的帳號登入工作台；第一次使用自動建立待審核帳號，須由管理員先啟用並指派個案
5. 每次重新登入用 SMS OTP；若登入工作階段仍有效，可能不必重新驗證。可透過「登出」清除該瀏覽器登入狀態。

### 必要的 Supabase 設定
1. 開啟 [Supabase Phone Provider](https://supabase.com/dashboard/project/zlkulrvbbjhxvimfhwjy/auth/providers)。
2. 在 **Authentication → Sign In / Providers → Phone** 啟用 Phone。
3. 設定簡訊供應商及發送憑證（如 Twilio、Vonage、MessageBird，依 Dashboard 可用項目），確認能送達台灣門號。供應商可能依簡訊計價。
4. 配置合適的 OTP 速率限制與 CAPTCHA，避免大量發送簡訊及費用濫用。
5. 研究期間可依 [官方測試門號指南](https://supabase.com/docs/guides/auth/testing-auth-flows) 設定虛構門號＋固定 OTP；託管 Supabase 仍要求配置 SMS 供應商。**正式使用前務必移除測試門號與固定驗證碼。**

**重要：手機號碼不能單獨證明身分。** SMS 驗證是必要步驟；未通過驗證的帳號不能取得個案資料權限。

## 建立第一位管理員
1. 使用自己的手機號碼在網站接收並完成 SMS 驗證。
2. 新帳號起初 `active=false`、角色 `staff`，不可查看任何個案。
3. 在 [SQL Editor](https://supabase.com/dashboard/project/zlkulrvbbjhxvimfhwjy/sql/new) 執行下列 SQL，將範例門號換成**自己剛驗證的**手機號碼國際格式。不要提供密碼或驗證碼給他人。

```sql
update public.profiles
set role = 'admin', active = true,
    display_name = '最高權限管理員'
where id = (
  select id from auth.users
  where phone = '+886912345678'
    and phone_confirmed_at is not null
)
returning id, display_name, role, active;
```

回傳 **1 列**才表示有成功啟用該管理員帳號；0 列代表手機號碼或驗證狀態不符合。完成後重新登入就能看到管理員後台。

管理員可在後台替其他已驗證門號的使用者填寫姓名、核准帳號、設定角色及指派個案。

## 安全注意
- 簡訊 OTP 不等於多因素驗證（MFA）；手機號碼可能換人或遭 SIM 交換攻擊。正式上線需評估管理員額外 MFA、登入時效、裝置安全及異常監控。
- 需要簡訊供應商才能實際發送驗證碼。未配置前，網站雖可開啟，不能完成手機登入。
- 簡訊供應商金鑰、Supabase Secret/Service Role、資料庫密碼不得放在 GitHub 或前端。
- 正式處理長照個案健康資訊前，需完成個資適法性、權限稽核、離職撤權、資料備份、資安測試。
