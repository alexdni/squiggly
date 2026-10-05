-- Replace the open "System can manage analyses" policy (FOR ALL, every role including anon,
-- USING true) with project-member policies. Applied to production 2026-10-05.
-- Server-side jobs write with the service role, which bypasses RLS.

DROP POLICY IF EXISTS "System can manage analyses" ON public.analyses;

DROP POLICY IF EXISTS "Editors can create analyses" ON public.analyses;
CREATE POLICY "Editors can create analyses"
  ON public.analyses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recordings r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = analyses.recording_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id
              AND pm.user_id = auth.uid()
              AND pm.role IN ('owner', 'collaborator')
          )
        )
    )
  );

DROP POLICY IF EXISTS "Members can update analyses" ON public.analyses;
CREATE POLICY "Members can update analyses"
  ON public.analyses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recordings r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = analyses.recording_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recordings r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = analyses.recording_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Editors can delete analyses" ON public.analyses;
CREATE POLICY "Editors can delete analyses"
  ON public.analyses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recordings r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = analyses.recording_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = p.id
              AND pm.user_id = auth.uid()
              AND pm.role IN ('owner', 'collaborator')
          )
        )
    )
  );
