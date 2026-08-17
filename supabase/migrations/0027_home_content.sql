-- HR-editable Home page card-grid sections. Replaces the two hardcoded boxes
-- ("Spotlight of the Month", "New Joiners") with an arbitrary number of
-- HR-created, titled boxes (home_content_sections), each holding a list of
-- person cards (home_content_items). See js/homeContent.js for the admin UI
-- and Home page renderer.
--
-- Permission model mirrors the rest of the portal: role_defaults (per-role
-- default) + user_permissions (per-user override), merged with override
-- winning — see get_permissions() in backend/api.py. RLS can't call that
-- Python function, so fn_home_content_can_manage() below re-implements the
-- same lookup in SQL (same shape as is_mis()/is_own_assigned_person() from
-- 0005_fix_rls_mis_check.sql), including the Employee_Dept -> role mapping
-- from backend/api.py's ROLE_MAP. If ROLE_MAP ever changes, update the CASE
-- expression below to match — this migration also adds an "hr" entry to
-- ROLE_MAP (see backend/api.py) so a role_defaults row keyed role='hr'
-- actually gets read; without that, HR-dept staff fall into the 'employee'
-- bucket and would never see this permission by role default.

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists home_content_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  icon text,
  accent_color text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table home_content_sections is
  'HR-editable titled boxes on the Home page (e.g. "Spotlight of the Month", "New Joiners", or anything HR types). icon/accent_color are short tokens picked from a small preset list in js/homeContent.js, not raw hex/emoji validation at the DB level. Deactivating a section (is_active=false) hides the whole box from Home but keeps its items intact.';

create table if not exists home_content_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references home_content_sections(id) on delete cascade,
  employee_name text not null,
  subtitle text,
  location text,
  extra_label text,
  photo_url text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table home_content_items is
  'One person/employee card inside a home_content_sections box. subtitle is the pill shown under the name (designation/department/whatever HR types), extra_label is a free-text badge on the card (e.g. "June 2026", "5 yrs completed"). is_active=false soft-deletes a card without losing history.';

create index if not exists idx_home_content_items_section on home_content_items(section_id);

-- ── Permission helper (SECURITY DEFINER — bypasses RLS on the tables it
-- reads so the check itself isn't blocked by the very policies it feeds) ──
create or replace function public.fn_home_content_can_manage()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_email    text := lower(auth.email());
  v_override text;
  v_dept     text;
  v_role     text;
  v_default  text;
begin
  if v_email is null then
    return false;
  end if;

  -- Per-user override always wins (mirrors get_permissions() step 2).
  select value into v_override
  from user_permissions
  where lower(user_email) = v_email
    and permission = 'home_content_manage'
  limit 1;

  if v_override is not null then
    return v_override = 'true';
  end if;

  -- Otherwise fall back to the role default (mirrors get_permissions() step 1),
  -- with role derived from Employee_details.Employee_Dept via the same
  -- mapping as backend/api.py's ROLE_MAP.
  select lower(trim(coalesce("Employee_Dept", ''))) into v_dept
  from "Employee_details"
  where lower("Email_Id") = v_email
  limit 1;

  v_role := case v_dept
    when 'managing director'   then 'owner'
    when 'mis'                 then 'mis'
    when 'pc'                  then 'pc'
    when 'executive assistant' then 'executive assistant'
    when 'ea'                  then 'executive assistant'
    when 'admin'                then 'admin'
    when 'hr'                  then 'hr'
    else 'employee'
  end;

  select value into v_default
  from role_defaults
  where role = v_role
    and permission = 'home_content_manage'
  limit 1;

  return coalesce(v_default, 'false') = 'true';
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table home_content_sections enable row level security;
alter table home_content_items    enable row level security;

drop policy if exists "home_content_sections_select_authenticated" on home_content_sections;
create policy "home_content_sections_select_authenticated" on home_content_sections
  for select to authenticated
  using (true);

drop policy if exists "home_content_sections_insert_manage" on home_content_sections;
create policy "home_content_sections_insert_manage" on home_content_sections
  for insert to authenticated
  with check (public.fn_home_content_can_manage());

drop policy if exists "home_content_sections_update_manage" on home_content_sections;
create policy "home_content_sections_update_manage" on home_content_sections
  for update to authenticated
  using (public.fn_home_content_can_manage())
  with check (public.fn_home_content_can_manage());

drop policy if exists "home_content_sections_delete_manage" on home_content_sections;
create policy "home_content_sections_delete_manage" on home_content_sections
  for delete to authenticated
  using (public.fn_home_content_can_manage());

drop policy if exists "home_content_items_select_authenticated" on home_content_items;
create policy "home_content_items_select_authenticated" on home_content_items
  for select to authenticated
  using (true);

drop policy if exists "home_content_items_insert_manage" on home_content_items;
create policy "home_content_items_insert_manage" on home_content_items
  for insert to authenticated
  with check (public.fn_home_content_can_manage());

drop policy if exists "home_content_items_update_manage" on home_content_items;
create policy "home_content_items_update_manage" on home_content_items
  for update to authenticated
  using (public.fn_home_content_can_manage())
  with check (public.fn_home_content_can_manage());

drop policy if exists "home_content_items_delete_manage" on home_content_items;
create policy "home_content_items_delete_manage" on home_content_items
  for delete to authenticated
  using (public.fn_home_content_can_manage());

-- ── Storage — public bucket, same pattern as field-service-photos ────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-content-photos', 'portal-content-photos', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Belt-and-suspenders: the bucket being public already serves reads via
-- /storage/v1/object/public/... with no auth check regardless of this
-- policy, but this keeps the authenticated listing/API path consistent.
drop policy if exists "portal_content_photos_public_read" on storage.objects;
create policy "portal_content_photos_public_read" on storage.objects
  for select
  using (bucket_id = 'portal-content-photos');

drop policy if exists "portal_content_photos_manage_write" on storage.objects;
create policy "portal_content_photos_manage_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'portal-content-photos' and public.fn_home_content_can_manage())
  with check (bucket_id = 'portal-content-photos' and public.fn_home_content_can_manage());

-- ── role_defaults seed — HR role gets this permission by default ────────
-- (no unique constraint assumed on role_defaults(role,permission); guarded
-- with a not-exists check instead of on-conflict so this is safely re-runnable)
insert into role_defaults (role, permission, value)
select 'hr', 'home_content_manage', 'true'
where not exists (
  select 1 from role_defaults where role = 'hr' and permission = 'home_content_manage'
);

-- ── Seed data — migrate today's hardcoded Home page content ──────────────
-- Sections (matching current icons/colors from index.html's hardcoded boxes)
insert into home_content_sections (title, icon, accent_color, display_order, is_active, created_by)
select 'Spotlight of the Month', '🏆', 'blue', 1, true, 'migration:0027'
where not exists (select 1 from home_content_sections where title = 'Spotlight of the Month');

insert into home_content_sections (title, icon, accent_color, display_order, is_active, created_by)
select 'New Joiners', '🌱', 'teal', 2, true, 'migration:0027'
where not exists (select 1 from home_content_sections where title = 'New Joiners');

-- Spotlight of the Month item — was hardcoded to Emp_id 7 (Saloni Raut) in
-- js/home.js's loadPerformers(); "June 2026" was the section-header date
-- badge, moved onto the card itself as extra_label since the new schema's
-- date/label slot lives on the item, not the section.
insert into home_content_items (section_id, employee_name, subtitle, location, extra_label, photo_url, display_order, is_active, created_by)
select s.id, e."Employee_name", coalesce(nullif(trim(e."Employee_Dept"), ''), 'Support'), e."Location", 'June 2026',
       coalesce(e."avatar_url", e."Link"), 0, true, 'migration:0027'
from home_content_sections s
cross join "Employee_details" e
where s.title = 'Spotlight of the Month'
  and e."Emp_id" = 7
  and not exists (
    select 1 from home_content_items i where i.section_id = s.id and i.employee_name = e."Employee_name"
  );

-- New Joiners items — was hardcoded to Emp_id [8, 81, 78, 80] in that exact
-- order in js/home.js's NEW_JOINER_ORDER (Vipul, Sowbhagya, Ankita, Disha).
insert into home_content_items (section_id, employee_name, subtitle, location, extra_label, photo_url, display_order, is_active, created_by)
select s.id, e."Employee_name", e."Employee_Dept", e."Location", null,
       coalesce(e."avatar_url", e."Link"), o.ord, true, 'migration:0027'
from home_content_sections s
cross join (values (8, 0), (81, 1), (78, 2), (80, 3)) as o(emp_id, ord)
join "Employee_details" e on e."Emp_id" = o.emp_id
where s.title = 'New Joiners'
  and not exists (
    select 1 from home_content_items i where i.section_id = s.id and i.employee_name = e."Employee_name"
  );

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'applied_migrations') then
    insert into applied_migrations (filename) values ('0027_home_content.sql')
    on conflict (filename) do nothing;
  end if;
end $$;