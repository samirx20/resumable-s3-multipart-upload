create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  bucket_name text not null,
  object_key text not null,
  upload_id text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0),
  file_last_modified bigint,
  chunk_size_bytes integer not null check (chunk_size_bytes >= 5242880),
  total_parts integer not null check (total_parts > 0),
  status text not null default 'uploading'
    check (status in ('uploading', 'completed', 'aborted', 'failed')),
  completed_at timestamptz,
  last_parts_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists upload_sessions_user_id_idx
  on public.upload_sessions (user_id);

create index if not exists upload_sessions_uploading_idx
  on public.upload_sessions (status, created_at)
  where status = 'uploading';

create unique index if not exists upload_sessions_storage_upload_idx
  on public.upload_sessions (bucket_name, object_key, upload_id);

create or replace function public.set_upload_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_upload_sessions_updated_at on public.upload_sessions;
create trigger set_upload_sessions_updated_at
before update on public.upload_sessions
for each row
execute function public.set_upload_sessions_updated_at();

alter table public.upload_sessions enable row level security;

-- If user_id points to auth.users(id), this lets users read their own sessions.
-- Server-side route handlers should still use a service role or backend-only DB credential.
drop policy if exists "Users can view own upload sessions" on public.upload_sessions;
create policy "Users can view own upload sessions"
on public.upload_sessions
for select
to authenticated
using (auth.uid() = user_id);
