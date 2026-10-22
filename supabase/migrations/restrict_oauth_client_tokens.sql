-- OAuth access tokens issued to third-party apps (the MCP connector) are user-level Supabase JWTs,
-- usable directly against PostgREST and Storage under the user's RLS. They carry a client_id claim;
-- browser session JWTs do not. These RESTRICTIVE policies are ANDed with every permissive policy,
-- so a token with a client_id can no longer write app tables or touch Storage at all.
-- Reads of app tables stay allowed (the MCP tools read through RLS with the same token); limiting
-- which columns those direct reads can see is a separate, pending decision.
-- Server-side jobs use the service role, which bypasses RLS. NOT YET APPLIED.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'project_members', 'recordings', 'analyses',
    'project_analyses', 'export_logs', 'eeg_annotations'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No writes from OAuth client tokens (insert)" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No writes from OAuth client tokens (insert)" ON public.%I '
      'AS RESTRICTIVE FOR INSERT TO authenticated '
      'WITH CHECK ((auth.jwt() ->> ''client_id'') IS NULL)', t);

    EXECUTE format('DROP POLICY IF EXISTS "No writes from OAuth client tokens (update)" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No writes from OAuth client tokens (update)" ON public.%I '
      'AS RESTRICTIVE FOR UPDATE TO authenticated '
      'USING ((auth.jwt() ->> ''client_id'') IS NULL) '
      'WITH CHECK ((auth.jwt() ->> ''client_id'') IS NULL)', t);

    EXECUTE format('DROP POLICY IF EXISTS "No writes from OAuth client tokens (delete)" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No writes from OAuth client tokens (delete)" ON public.%I '
      'AS RESTRICTIVE FOR DELETE TO authenticated '
      'USING ((auth.jwt() ->> ''client_id'') IS NULL)', t);
  END LOOP;
END $$;

-- Storage: no access of any kind (recordings, cleaned files and visuals carry names and raw EEG)
DROP POLICY IF EXISTS "No storage access from OAuth client tokens (select)" ON storage.objects;
CREATE POLICY "No storage access from OAuth client tokens (select)"
  ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "No storage access from OAuth client tokens (insert)" ON storage.objects;
CREATE POLICY "No storage access from OAuth client tokens (insert)"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "No storage access from OAuth client tokens (update)" ON storage.objects;
CREATE POLICY "No storage access from OAuth client tokens (update)"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((auth.jwt() ->> 'client_id') IS NULL)
  WITH CHECK ((auth.jwt() ->> 'client_id') IS NULL);

DROP POLICY IF EXISTS "No storage access from OAuth client tokens (delete)" ON storage.objects;
CREATE POLICY "No storage access from OAuth client tokens (delete)"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'client_id') IS NULL);
