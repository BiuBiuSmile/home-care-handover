-- Home Care Handover: security-first Supabase schema (run once in SQL editor)
-- Never put a Supabase service_role / secret key in GitHub Pages.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('admin','supervisor','staff')),
  active boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.on_user_registered()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, role, active)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''), nullif(split_part(coalesce(new.email,''),'@',1),''), '待審核人員 · 尾碼' || right(coalesce(nullif(new.phone,''),'????'),4)), 80), 'staff', false)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.on_user_registered();

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=auth.uid() and p.active and not p.must_change_password and u.confirmed_at is not null);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=auth.uid() and p.active and p.role='admin'
    and not p.must_change_password and u.confirmed_at is not null);
$$;

create or replace function public.on_auth_password_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password=false where id=new.id;
  end if;
  return new;
end; $$;
create trigger on_auth_user_password_changed
after update of encrypted_password on auth.users
for each row execute function public.on_auth_password_changed();

create table public.cases (
  id text primary key check (length(trim(id)) between 2 and 40),
  name text not null check (length(trim(name)) between 1 and 100),
  area text not null default '',
  service text not null default '',
  focus jsonb not null default '[]'::jsonb check (jsonb_typeof(focus) = 'array'),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.case_assignments (
  case_id text not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_id,user_id)
);
create index case_assignments_user_idx on public.case_assignments(user_id);

create or replace function public.can_access_case(p_case_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active() and (
    public.is_admin()
    or exists(select 1 from public.case_assignments a where a.user_id = auth.uid() and a.case_id = p_case_id)
  );
$$;

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.cases(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  author_name text not null default '',
  kind text not null check (kind in ('日常照顧','環境與安全','生活習慣','家屬溝通','異常狀況','服務調整')),
  risk text not null check (risk in ('一般','提醒','緊急')),
  summary text not null check(length(trim(summary)) between 1 and 100),
  description text not null check(length(trim(description)) between 8 and 2000),
  expires_on date,
  created_at timestamptz not null default now()
);
create index handovers_case_time_idx on public.handovers(case_id,created_at desc);

create or replace function public.stamp_handover_author()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.can_access_case(new.case_id) then
    raise exception 'not authorized to create handover' using errcode = '42501';
  end if;
  new.author_id := auth.uid();
  select p.display_name into new.author_name from public.profiles p where p.id = auth.uid();
  new.author_name := coalesce(new.author_name, '未知人員');
  new.created_at := now();
  return new;
end; $$;

create trigger handover_stamp_author
before insert on public.handovers
for each row execute function public.stamp_handover_author();

create table public.case_reads (
  case_id text not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(case_id,user_id)
);

create or replace function public.mark_case_read(p_case_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.can_access_case(p_case_id) then
    raise exception 'not authorized to mark case read' using errcode = '42501';
  end if;
  insert into public.case_reads(case_id,user_id,read_at)
  values (p_case_id,auth.uid(),now())
  on conflict(case_id,user_id) do update set read_at = now();
end; $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger cases_touch before update on public.cases
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_assignments enable row level security;
alter table public.handovers enable row level security;
alter table public.case_reads enable row level security;

create policy "profiles_self_or_admin_select" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles_admin_update" on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "cases_authorized_select" on public.cases
for select to authenticated using (public.can_access_case(id));
create policy "cases_admin_insert" on public.cases
for insert to authenticated with check (public.is_admin());
create policy "cases_admin_update" on public.cases
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "assignments_self_or_admin_select" on public.case_assignments
for select to authenticated using ((user_id = auth.uid() and public.is_active()) or public.is_admin());
create policy "assignments_admin_insert" on public.case_assignments
for insert to authenticated with check (public.is_admin());
create policy "assignments_admin_delete" on public.case_assignments
for delete to authenticated using (public.is_admin());

create policy "handovers_authorized_select" on public.handovers
for select to authenticated using (public.can_access_case(case_id));
create policy "handovers_authorized_insert" on public.handovers
for insert to authenticated with check (author_id = auth.uid() and public.can_access_case(case_id));

create policy "reads_self_or_admin_select" on public.case_reads
for select to authenticated using ((user_id = auth.uid() and public.can_access_case(case_id)) or public.is_admin());

-- Explicit privileges: no anonymous access to any care data.
revoke all on public.profiles, public.cases, public.case_assignments, public.handovers, public.case_reads from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,role,active) on public.profiles to authenticated;
grant select, insert, update on public.cases to authenticated;
grant select, insert, delete on public.case_assignments to authenticated;
grant select, insert(case_id,kind,risk,summary,description,expires_on) on public.handovers to authenticated;
grant select on public.case_reads to authenticated;
revoke all on function public.is_active(), public.is_admin(), public.can_access_case(text), public.mark_case_read(text) from public;
grant execute on function public.is_active(), public.is_admin(), public.can_access_case(text), public.mark_case_read(text) to authenticated;


-- Guard against lockout: a signed-in admin cannot deactivate/demote themself,
-- and no request may deactivate/demote the last active administrator.
create or replace function public.guard_admin_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if auth.uid() = old.id then
      raise exception 'cannot deactivate or demote your own admin account'
        using errcode = '42501';
    end if;
    if (select count(*) from public.profiles p where p.role = 'admin' and p.active) <= 1 then
      raise exception 'cannot deactivate or demote the last active administrator'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

create trigger profiles_admin_guard before update on public.profiles
for each row execute function public.guard_admin_updates();

-- Remove inherited PUBLIC EXECUTE privileges on SECURITY DEFINER helpers.
revoke execute on function public.on_user_registered() from public, anon, authenticated;
revoke execute on function public.on_auth_password_changed() from public, anon, authenticated;
revoke execute on function public.stamp_handover_author() from public, anon, authenticated;
revoke execute on function public.guard_admin_updates() from public, anon, authenticated;
revoke execute on function public.is_active() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.can_access_case(text) from public, anon, authenticated;
revoke execute on function public.mark_case_read(text) from public, anon, authenticated;
grant execute on function public.is_active(), public.is_admin(), public.can_access_case(text), public.mark_case_read(text) to authenticated;

-- ONE-TIME FIRST ADMIN BOOTSTRAP (run manually in SQL editor after signing up).
-- Replace the phone with your own verified +886 number. NEVER put this in browser JS.
-- update public.profiles set role='admin', active=true
-- where id = (select id from auth.users
--             where phone = '+886912345678' and phone_confirmed_at is not null);
