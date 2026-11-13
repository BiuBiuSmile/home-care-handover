# 安護交班｜居家服務交班平台

獨立研究專案：`BiuBiuSmile/home-care-handover`。網站使用 GitHub Pages，登入與交班資料以 Supabase Auth + PostgreSQL / RLS 管理，不使用 Railway。

## 最新版：管理員建立員工帳號

- **員工帳號**：台灣手機門號（09xxxxxxxx）。
- **密碼**：管理員從後台建立帳號後，取得**系統產生的一次性初始密碼**。員工首次登入必須自行更改；個案權限在密碼更改前一律封鎖。
- **安全原則**：不蒐集身分證字號作為密碼（身分證號易遭取得，不能當固定登入密碼）。
- **無自助註冊**：員工帳號只能由登入的管理員建立，管理員建檔透過 Supabase Edge Function 執行，不在 GitHub Pages 放管理密鑰。
- 管理員可維護個案、指派服務人員及調整人員權限；居服員／居督只能看已指派個案。
- `demo.html` 是使用虛構個案、瀏覽器本機儲存的展示版，與正式資料分開。

## 主要檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 手機＋密碼登入、首次密碼更新、交班及管理員後台 |
| `portal.js` | 登入、管理員建檔、權限與交班流程 |
| `config.js` | Supabase 專案 URL 和公開 Publishable Key（非私密金鑰） |
| `supabase/schema.sql` | Supabase 資料表與權限設計 |
| `supabase/functions/admin-create-staff/index.ts` | 管理員專用建立員工帳號的伺服器功能 |
| `bootstrap-admin.html` | **僅初次設定用**的臨時管理員入口，初始化後應刪除 |
| `docs/LOGIN_ADMIN_SETUP.md` | [完整登入與第一位管理員設定指南](docs/LOGIN_ADMIN_SETUP.md) |

## 使用網址

[安護交班正式入口](https://biubiusmile.github.io/home-care-handover/)

## 安全與限制

此階段沒有真實使用者的端對端登入測試，仍需先建立第一位管理員，並確認 Supabase Phone Provider 可用。**在完成安全稽核與法規評估前，不要輸入真實個案／健康資料。** 尚需補強 MFA、操作稽核、帳號復原、備份、換號及離職撤權等功能。
