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

// Auth aliases are under the site's own domain, never real staff mailboxes.
const INTERNAL_EMAIL_DOMAIN = "staff-login.chkia.dev";
function staffEmail(phone: string) {
  return "u" + phone.replace(/[^0-9]/g, "") + "@" + INTERNAL_EMAIL_DOMAIN;
}
function passwordError(value: unknown, phone?: string | null): string | null {
  if (typeof value !== "string") return "請輸入密碼";
  if (value.length < 10 || value.length > 72) return "密碼長度須為 10～72 字元";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "密碼至少要包含英文字母與數字";
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
    // Read-only status and separately confirmed migration, administrator only.
    if (action === "migration_status" || action === "migrate_logins") {
      const { data: people, error: peopleError } = await db.from("profiles")
        .select("id,display_name,role,login_phone")
        .in("role", ["staff","supervisor"])
        .order("id", { ascending:true }).limit(500);
      if (peopleError || !people) return reply(500,"無法核對員工帳號狀態");
      const rows = await Promise.all(people.map(async (p) => {
        const { data: record, error } = await db.auth.admin.getUserById(p.id);
        if (error || !record?.user) return { id:p.id, state:"error", name:p.display_name, last4:"" };
        const u = record.user;
        const phone = normalizePhone(p.login_phone || u.phone);
        const alias = phone ? staffEmail(phone) : "";
        const last4 = phone?.slice(-4) || "";
        const hasEmailIdentity = (u.identities || []).some(
          (i) => i.provider === "email"
        );
        if (!phone || !alias) return { id:p.id, state:"invalid_phone", name:p.display_name, last4 };
        if (u.email && u.email.toLowerCase() !== alias) {
          return { id:p.id, state:"conflict", name:p.display_name, last4 };
        }
        if (u.email?.toLowerCase() === alias && !!u.email_confirmed_at && hasEmailIdentity) {
          return { id:p.id, state:"converted", name:p.display_name, last4 };
        }
        return { id:p.id, state:"pending", name:p.display_name, last4, alias };
      }));
      const count = (type: string) => rows.filter((x)=>x.state===type).length;
      const candidates = rows.filter((x)=>x.state==="pending");
      const summary = () => ({
        total:rows.length,
        converted:count("converted"),
        pending:count("pending"),
        errors:count("error")+count("invalid_phone")+count("conflict"),
        pilot:candidates.length ? { name:candidates[0].name, last4:candidates[0].last4 } : null,
      });
      if (action === "migration_status") return reply(200,"已取得員工登入方式狀態",summary());
      if (String(payload.confirm || "") !== "轉換員工登入") {
        return reply(400,"必須明確確認「轉換員工登入」");
      }
      if (summary().errors) return reply(409,"有帳號不符，為安全起見停止批次轉換",summary());
      const batch = payload.pilot === true ? candidates.slice(0,1) : candidates;
      let changed = 0;
      for (const row of batch) {
        if (!row.alias) continue;
        // Update existing user, do NOT create a new user / reset password / change ID.
        const { data: updated, error } = await db.auth.admin.updateUserById(
          row.id, { email: row.alias, email_confirm:true }
        );
        if (error || updated.user?.id !== row.id) {
          return reply(409,"部分帳號已轉換，但有更新失敗；請重新檢查狀態",
            { changed, failed_user_suffix:row.id.slice(-6) });
        }
        const { data: verified, error: verifyError } = await db.auth.admin.getUserById(row.id);
        const verifiedIdentity = (verified?.user?.identities || []).some(
          (i) => i.provider === "email"
        );
        if (verifyError || !verified?.user || verified.user.email?.toLowerCase() !== row.alias
            || !verified.user.email_confirmed_at || !verifiedIdentity) {
          return reply(409,"Email 已寫入，但確認身分尚未完成，請停止並核對",
            { changed, failed_user_suffix:row.id.slice(-6) });
        }
        changed++;
      }
      return reply(200, payload.pilot === true
        ? "已完成 1 位測試帳號的 Email 登入身分轉換；請先驗證原密碼再處理其他員工"
        : "已完成員工登入身分轉換",
        { changed, converted:count("converted")+changed, total:rows.length,
          remaining:Math.max(0,candidates.length-changed),
          test_user: payload.pilot===true && batch[0]
            ? { name:batch[0].name, last4:batch[0].last4 } : null });
    }

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
      const { data: duplicate, error: lookupIssue } = await db.from("profiles")
        .select("id").eq("login_phone", phone.slice(1)).maybeSingle();
      if (lookupIssue) return reply(500, "目前無法檢查手機帳號是否重複");
      if (duplicate) return reply(409, "這個手機號碼已經建立員工帳號");

      const { data: created, error: createError } = await db.auth.admin.createUser({
        email:staffEmail(phone),
        email_confirm:true,
        password,
        user_metadata: { display_name: name },
      });
      if (createError || !created.user) {
        return reply(409, "帳號建立失敗：員工手機帳號可能已被使用，或密碼不符合 Supabase 設定");
      }
      const { data: savedProfile, error: profileError } = await db.from("profiles").update({
        display_name: name,
        role,
        active: true,
        must_change_password: false,
        login_phone:phone.slice(1),
      }).eq("id", created.user.id).select("id").single();
      if (profileError || !savedProfile) {
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
        .select("role,active,login_phone").eq("id", id).maybeSingle();
      if (targetError || !target || !["staff", "supervisor"].includes(target.role)) {
        return reply(403, "只能重設居服員或居督的密碼");
      }
      const { data: authUser, error: lookupError } = await db.auth.admin.getUserById(id);
      if (lookupError || !authUser.user) return reply(404, "員工登入帳號不存在");
      const issue = passwordError(password, normalizePhone(target.login_phone || authUser.user.phone));
      if (issue) return reply(400, issue);
      const { error: updateError } = await db.auth.admin.updateUserById(id, { password });
      if (updateError) return reply(400, "密碼更新失敗，請確認密碼符合系統設定");
      const { error: profileError } = await db.from("profiles").update({
        must_change_password: false,
      }).eq("id", id);
      if (profileError) return reply(500, "密碼已重設，但使用者權限未確認，請聯絡系統管理員");
      return reply(200, "已重設員工密碼。請安全告知本人，原密碼將不能再用來重新登入");
    }

    if (action === "delete_user") {
      const id = String(payload.user_id ?? "");
      const confirmWord = String(payload.confirm ?? "");
      if (confirmWord !== "刪除") return reply(400, "請輸入「刪除」以確認");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return reply(400, "員工識別碼格式不正確");
      if (id === signedIn.user.id) return reply(403, "不能刪除自己的管理員帳號");

      // Server-side authorization, regardless of what the browser shows.
      const { data: target, error: targetError } = await db.from("profiles")
        .select("id,display_name,role")
        .eq("id", id).maybeSingle();
      if (targetError || !target) return reply(404, "找不到此使用者帳號");
      if (target.role !== "staff" && target.role !== "supervisor")
        return reply(403, "為避免管理權限遺失，此功能不能刪除管理員帳號");

      // Audit must be created before the destructive action.
      const { data: event, error: eventError } = await db.from("admin_account_events")
        .insert({
          actor_id: signedIn.user.id,
          target_id: id,
          target_display_name: target.display_name,
          target_role: target.role,
          action: "delete_user",
          status: "initiated"
        }).select("id").single();
      if (eventError || !event) return reply(500, "無法建立操作稽核紀錄，帳號尚未刪除");

      // Auth removes profiles and assignments by CASCADE. Handovers.author_id
      // is SET NULL; handovers.author_name and its historical content remain.
      const { error: deleteError } = await db.auth.admin.deleteUser(id);
      if (deleteError) {
        await db.from("admin_account_events").update({
          status: "failed", finished_at: new Date().toISOString()
        }).eq("id", event.id);
        return reply(409, "刪除失敗，帳號未移除；請檢查資料關聯或帳號狀態");
      }

      const { error: auditError } = await db.from("admin_account_events")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", event.id);
      if (auditError) return reply(200, "使用者帳號已刪除，但稽核完成狀態需由管理員複核");
      return reply(200, "已刪除員工帳號及指派權限，歷史交班紀錄保留");
    }

    return reply(400, "不支援的操作");
  } catch {
    // Do not expose raw errors that might include credentials.
    return reply(500, "操作失敗，請稍後重試並檢查管理員權限");
  }
});
