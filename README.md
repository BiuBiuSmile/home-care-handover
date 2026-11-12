# 安護交班｜居家服務交班平台

**獨立研究專案**：`BiuBiuSmile/home-care-handover`，不與其他專案共用資料庫或網站。

## 登入方式

- **手機門號 + 簡訊驗證碼（OTP）**：台灣 09 開頭或 +8869...，**完全不需要電子信箱或密碼**。
- 首次使用或重新登入時，輸入手機門號即可要求發送驗證碼；須先啟用 Supabase Phone 與 SMS 供應商，可能產生簡訊費用。
- 新帳號預設待管理員審核（`active=false`）；未通過審核不能查閱個案。
- 首次成功驗證手機後，自動建立待審核帳號；管理員可填寫員工姓名並核准。居服員與督導只可存取被指派個案。原始紀錄保留。
- 首位管理員須完成門號驗證後，由 Supabase SQL Editor 指定角色；**沒有預設管理員密碼**。

## 專案檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 手機號碼輸入、簡訊驗證、管理員及交班頁面（無密碼欄位） |
| `portal.js` | Supabase Auth、後台管理、個案指派與交班／已讀流程 |
| `config.js` | 已設定 Supabase **公開**網址及 Publishable Key（不可放 Secret Key） |
| `supabase/schema.sql` | 資料表和 RLS 權限；已部署至專用 Supabase 專案 |
| `demo.html` | 原本的虛構個案展示版，不會寫入 Supabase |
| `docs/LOGIN_ADMIN_SETUP.md` | [手機登入與首位管理員設定教學](docs/LOGIN_ADMIN_SETUP.md) |

## 網站

GitHub Pages：`https://biubiusmile.github.io/home-care-handover/`

設定：Settings → Pages → Deploy from a branch → main → /(root)。

## 正式啟用前

**目前未完成簡訊供應商設定，也尚未經過完整手機驗證與管理員實機測試。** 請先用虛構個案操作，不能放真實個案或健康資料。需再補足 MFA、操作稽核、資料備份、帳戶復原和資安／法規查核。
