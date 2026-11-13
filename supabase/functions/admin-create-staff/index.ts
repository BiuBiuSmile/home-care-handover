import { createClient } from "npm:@supabase/supabase-js@2.57.0";

// Only the deployed Edge Function has the service-role credential.
// The browser is permitted to invoke this function, but EVERY call checks
// a live Supabase Auth JWT and the caller's database admin role.
const ALLOWED_ORIGIN = "https://biubiusmile.github.io";
const headers = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function reply(status: number, message: string, extras: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ message, ...extras }), { status, headers });
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[\s()-]/g, "");
  if (/^09\d{8}$/.test(raw)) return "+886" + raw.slice(1);
  if (/^8869\d{8}$/.test(raw)) return "+" + raw;
  if (/^\+8869\d{8}$/.test(raw)) return raw;
  return null;
}

function passwordError(value: unknown, phone?: string | null): string | null {
  if (typeof value !== "string") return "請輸入密碼";
  if (value.length < 10 || value.length > 72) return "密碼長度須為 10～72 字元";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "密碼至少要包含英文字母與數字";
  if (/^[A-Za-z][12]\d{8}$/.test(value)) return "請勿以身分證字號作為密碼";
  if (phone && (value.includes(phone.slice(-9)) || value.includes("0" + phone.slice(-9)))) {
    return "密碼不能包含自己的手機號碼";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "只允許 POST");
  if (req.headers.get("origin") !== ALLOWED_ORIGIN) return reply(403, "不允許此網站來源");

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(401, "需要管理員登入");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return reply(503, "伺服器尚未完成設定");
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: signedIn, error: authError } = await db.auth.getUser(token);
    if (authError || !signedIn.user) return reply(401, "登入失效，請重新登入");

    const { data: admin, error: adminError } = await db.from("profiles")
      .select("role,active,must_change_password")
      .eq("id", signedIn.user.id).maybeSingle();
    if (adminError || !admin || !admin.active || admin.role !== "admin" || admin.must_change_password) {
      return reply(403, "只有已啟用且完成初始設定的管理員可操作帳號");
    }

    const payload = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return reply(400, "請提供有效資料");
    }

    const action = String(payload.action ?? "create");
    // Do not log or return passwords. Supabase Auth stores only password hashes.
    const password = payload.password;
    if (action === "create") {
      const name = String(payload.display_name ?? "").trim();
      const phone = normalizePhone(payload.phone);
      const role = String(payload.role ?? "");
      if (!name || name.length > 80) return reply(400, "員工姓名不正確");
      if (!phone) return reply(400, "請輸入有效的台灣手機門號");
      if (role !== "staff" && role !== "supervisor") return reply(400, "只能新增居服員或居督");
      const issue = passwordError(password, phone);
      if (issue) return reply(400, issue);

      const { data: created, error: createError } = await db.auth.admin.createUser({
        phone,
        phone_confirm: true,
        password,
        user_metadata: { display_name: name },
      });
      if (createError || !created.user) {
        return reply(409, "帳號建立失敗：手機號碼可能已被使用，或密碼不符合 Supabase 設定");
      }
      const { error: profileError } = await db.from("profiles").update({
        display_name: name,
        role,
        active: true,
        must_change_password: false,
      }).eq("id", created.user.id);
      if (profileError) {
        // Fail closed. on_user_registered defaults the profile to inactive.
        return reply(500, "登入帳號已建立，但權限設定未成功；請管理員查核後再啟用");
      }
      return reply(201, "員工帳號已建立，可直接使用管理員設定的密碼登入", {
        user_id: created.user.id,
        phone_last4: phone.slice(-4),
      });
    }

    if (action === "reset_password") {
      const id = String(payload.user_id ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply(400, "員工識別碼不正確");
      }
      if (id === signedIn.user.id) return reply(403, "不能透過此功能變更自己的管理員密碼");

      const { data: target, error: targetError } = await db.from("profiles")
        .select("role,active").eq("id", id).maybeSingle();
      if (targetError || !target || !["staff", "supervisor"].includes(target.role)) {
        return reply(403, "只能重設居服員或居督的密碼");
      }
      const { data: authUser, error: lookupError } = await db.auth.admin.getUserById(id);
      if (lookupError || !authUser.user) return reply(404, "員工登入帳號不存在");
      const issue = passwordError(password, authUser.user.phone);
      if (issue) return reply(400, issue);
      const { error: updateError } = await db.auth.admin.updateUserById(id, { password });
      if (updateError) return reply(400, "密碼更新失敗，請確認密碼符合系統設定");
      const { error: profileError } = await db.from("profiles").update({
        must_change_password: false,
      }).eq("id", id);
      if (profileError) return reply(500, "密碼已重設，但使用者權限未確認，請聯絡系統管理員");
      return reply(200, "已重設員工密碼。請安全告知本人，原密碼將不能再用來重新登入");
    }

    return reply(400, "不支援的操作");
  } catch {
    // Do not expose raw errors that might include credentials.
    return reply(500, "操作失敗，請稍後重試並檢查管理員權限");
  }
});
