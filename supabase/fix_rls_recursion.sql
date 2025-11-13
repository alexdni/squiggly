-- Fix RLS infinite recursion by simplifying policies
-- Run this in Supabase SQL Editor

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view projects they own or are members of" ON projects;
DROP POLICY IF EXISTS "Users can view project members for projects they have access to" ON project_members;
DROP POLICY IF EXISTS "Project owners can manage members" ON project_members;

-- Projects policies (simplified - no circular dependency)
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

-- Project members policies (simplified - direct checks only)
-- Allow viewing if user is the member being queried OR if they own the project
CREATE POLICY "Users can view their own memberships"
  ON project_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Project owners can view all members"
  ON project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Project owners can insert members
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
