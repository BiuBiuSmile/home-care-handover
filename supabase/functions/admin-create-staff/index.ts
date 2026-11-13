import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ALLOWED_ORIGIN = "https://biubiusmile.github.io";
const headers = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

const respond = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ message, ...extra }), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return respond(405, "僅支援 POST");
  if (req.headers.get("origin") !== ALLOWED_ORIGIN) return respond(403, "不允許此網站來源");

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return respond(401, "需要管理員登入");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return respond(503, "伺服器尚未設定完成");

  // This key exists ONLY in the Supabase Edge Function environment, never in GitHub Pages.
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: signedIn, error: authError } = await db.auth.getUser(token);
    if (authError || !signedIn.user) return respond(401, "登入狀態失效，請重新登入");
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role,active,must_change_password")
      .eq("id", signedIn.user.id)
      .maybeSingle();
    if (profileError || !profile || !profile.active || profile.role !== "admin" || profile.must_change_password)
      return respond(403, "只有完成密碼設定的管理員可以建立帳號");

    const body = await req.json();
    if (!body || typeof body !== "object") return respond(400, "輸入資料不正確");
    const display_name = String(body.display_name || "").trim();
    const phoneInput = String(body.phone || "").replace(/[\s()-]/g, "");
    const phone = /^09\d{8}$/.test(phoneInput)
      ? "+886" + phoneInput.slice(1)
      : /^(\+8869\d{8})$/.test(phoneInput)
      ? phoneInput
      : /^8869\d{8}$/.test(phoneInput)
      ? "+" + phoneInput
      : "";
    // Temporary password uses cryptographically strong randomness; the national ID is not collected.
    const randomBytes = crypto.getRandomValues(new Uint8Array(18));
    const firstPassword = btoa(String.fromCharCode(...randomBytes)).replace(/\+/g, "A").replace(/\//g, "b");
    const role = String(body.role || "staff");
    if (!display_name || display_name.length > 80) return respond(400, "請輸入有效員工姓名");
    if (!phone) return respond(400, "請輸入有效的台灣手機門號");
    if (!["staff", "supervisor"].includes(role)) return respond(400, "請選擇居服員或居督");
    const { data: created, error: createError } = await db.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: firstPassword,
      user_metadata: { display_name },
    });
    if (createError || !created.user) {
      // No sensitive credential is sent back or written to logs.
      return respond(createError?.status === 422 ? 409 : 400,
        "帳號建立失敗；請確認手機號碼未被使用，且符合 Supabase 密碼規則");
    }
    const { error: updateError } = await db.from("profiles").update({
      display_name,
      role,
      active: true,
      must_change_password: true,
    }).eq("id", created.user.id);
    if (updateError) {
      // Fail closed: user remains inactive / with initial password change required.
      return respond(500, "登入帳號已建立，但人員權限尚未設定。請通知系統管理員檢查資料庫");
    }
    return respond(201, "帳號已建立；請妥善轉交一次性密碼，員工首次登入需更改", {
      user_id: created.user.id,
      phone_last4: phone.slice(-4),
      initial_password: firstPassword,
    });
  } catch {
    return respond(500, "建立帳號時發生錯誤，請檢查輸入與伺服器設定");
  }
});
