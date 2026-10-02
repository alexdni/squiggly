-- Migration: TheraQ four-phase comparison
-- Adds the recording phase label and the project-level analyses table.
-- Safe to run on existing databases (idempotent).

-- 1. Phase label on recordings
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS phase TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recordings_phase_check'
  ) THEN
    ALTER TABLE recordings
      ADD CONSTRAINT recordings_phase_check
      CHECK (phase IN ('EO1', 'EC', 'EO2', 'TASK'));
  END IF;
END$$;

-- 2. Project-level analyses (TheraQ)
CREATE TABLE IF NOT EXISTS project_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'theraq',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  phase_map JSONB NOT NULL,
  config JSONB NOT NULL,
  results JSONB,
  error_log TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_analyses_project ON project_analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_analyses_status ON project_analyses(status);

DROP TRIGGER IF EXISTS update_project_analyses_updated_at ON project_analyses;
CREATE TRIGGER update_project_analyses_updated_at BEFORE UPDATE ON project_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. RLS (Supabase only; harmless if already enabled)
ALTER TABLE project_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view project analyses for their projects" ON project_analyses;
CREATE POLICY "Users can view project analyses for their projects"
  ON project_analyses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_analyses.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members
          WHERE project_members.project_id = projects.id
          AND project_members.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "System can manage project analyses" ON project_analyses;
CREATE POLICY "System can manage project analyses"
  ON project_analyses FOR ALL
  USING (true)
  WITH CHECK (true);
