-- Raw usage events for the admin usage dashboard (/admin).
--
-- Reads auth.* tables, which PostgREST does not expose, so it runs as SECURITY DEFINER. Only the
-- service role may call it: the app checks the caller is an admin before calling it with the
-- service-role key. Activity is approximated from auth.refresh_tokens (an open tab refreshes its
-- token about hourly) and from sessions, which are removed on sign-out, so history is a lower bound.

create or replace function public.admin_usage_events()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'confirmed', u.email_confirmed_at is not null
      ) order by u.created_at)
      from auth.users u
      where u.deleted_at is null
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'created_at', s.created_at,
        'last_seen_at', coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at),
        'oauth', s.oauth_client_id is not null
      ) order by s.created_at)
      from auth.sessions s
    ), '[]'::jsonb),
    -- One row per user per hour in which their token was refreshed
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'hour', a.hour, 'n', a.n) order by a.hour)
      from (
        select rt.user_id::uuid as user_id, date_trunc('hour', rt.created_at) as hour, count(*) as n
        from auth.refresh_tokens rt
        where rt.user_id ~ '^[0-9a-f-]{36}$'
        group by 1, 2
      ) a
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'owner_id', p.owner_id, 'created_at', p.created_at))
      from public.projects p
    ), '[]'::jsonb),
    'recordings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'user_id', r.uploaded_by,
        'created_at', r.created_at,
        'file_size', r.file_size,
        'duration_seconds', r.duration_seconds,
        'ext', lower(substring(r.filename from '\.([A-Za-z0-9]+)$'))
      ) order by r.created_at)
      from public.recordings r
    ), '[]'::jsonb),
    -- Re-analysis reuses the analysis row, so started_at is the latest run
    'analyses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', an.id,
        'user_id', r.uploaded_by,
        'status', an.status,
        'created_at', an.created_at,
        'started_at', an.started_at,
        'completed_at', an.completed_at
      ) order by an.created_at)
      from public.analyses an
      join public.recordings r on r.id = an.recording_id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', e.created_by, 'created_at', e.created_at))
      from public.eeg_annotations e
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_usage_events() from public, anon, authenticated;
grant execute on function public.admin_usage_events() to service_role;
