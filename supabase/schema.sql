-- Squiggly Database Schema for Supabase
-- Run this in the Supabase SQL Editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Project members table (for collaboration)
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'collaborator', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Recordings table
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  duration_seconds NUMERIC(10, 2) NOT NULL,
  sampling_rate INTEGER NOT NULL,
  n_channels INTEGER NOT NULL,
  montage TEXT NOT NULL DEFAULT '10-20',
  reference TEXT NOT NULL DEFAULT 'LE',
  eo_label TEXT,
  ec_label TEXT,
  eo_start NUMERIC(10, 2),
  eo_end NUMERIC(10, 2),
  ec_start NUMERIC(10, 2),
  ec_end NUMERIC(10, 2),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analyses table
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  config JSONB NOT NULL,
  results JSONB,
  error_log TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Export logs table
CREATE TABLE IF NOT EXISTS export_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL CHECK (export_type IN ('pdf', 'json', 'png', 'zip')),
  file_path TEXT NOT NULL,
  exported_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_recordings_project ON recordings(project_id);
CREATE INDEX idx_recordings_uploaded_by ON recordings(uploaded_by);
CREATE INDEX idx_analyses_recording ON analyses(recording_id);
CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_export_logs_analysis ON export_logs(analysis_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analyses_updated_at BEFORE UPDATE ON analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_logs ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "Users can view projects they own or are members of"
  ON projects FOR SELECT
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = projects.id
      AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create their own projects"
  ON projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Project owners can update their projects"
  ON projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Project owners can delete their projects"
  ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- Project members policies (simplified to avoid recursion)
-- Users can view their own memberships
CREATE POLICY "Users can view their own memberships"
  ON project_members FOR SELECT
  USING (user_id = auth.uid());

-- Project owners can view all members of their projects
CREATE POLICY "Project owners can view all members"
  ON project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Project owners can add members
CREATE POLICY "Project owners can add members"
  ON project_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Project owners can update members
CREATE POLICY "Project owners can update members"
  ON project_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Project owners can delete members
CREATE POLICY "Project owners can delete members"
  ON project_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Recordings policies
CREATE POLICY "Users can view recordings in their projects"
  ON recordings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = recordings.project_id
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

CREATE POLICY "Users can upload recordings to their projects"
  ON recordings FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = recordings.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members
          WHERE project_members.project_id = projects.id
          AND project_members.user_id = auth.uid()
          AND project_members.role IN ('owner', 'collaborator')
        )
      )
    )
  );

CREATE POLICY "Owners and collaborators can delete recordings"
  ON recordings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = recordings.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members
          WHERE project_members.project_id = projects.id
          AND project_members.user_id = auth.uid()
          AND project_members.role IN ('owner', 'collaborator')
        )
      )
    )
  );

-- Analyses policies
CREATE POLICY "Users can view analyses for recordings they have access to"
  ON analyses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recordings
      JOIN projects ON recordings.project_id = projects.id
      WHERE recordings.id = analyses.recording_id
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

CREATE POLICY "System can manage analyses"
  ON analyses FOR ALL
  USING (true)
  WITH CHECK (true);

-- Export logs policies
CREATE POLICY "Users can view their own export logs"
  ON export_logs FOR SELECT
  USING (
    exported_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM analyses
      JOIN recordings ON analyses.recording_id = recordings.id
      JOIN projects ON recordings.project_id = projects.id
      WHERE analyses.id = export_logs.analysis_id
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

CREATE POLICY "Users can create export logs"
  ON export_logs FOR INSERT
  WITH CHECK (exported_by = auth.uid());

-- Storage buckets policies (to be configured in Supabase dashboard)
-- Create these buckets in the Supabase Storage UI:
-- 1. recordings (private)
-- 2. visuals (private)
-- 3. exports (private)

-- Storage policies can be configured via:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('recordings', 'recordings', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('visuals', 'visuals', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('exports', 'exports', false);
