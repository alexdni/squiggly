-- COMPLETE RLS FIX - Run this in Supabase SQL Editor
-- This will drop ALL existing policies and recreate them correctly

-- ============================================
-- STEP 1: Drop ALL existing policies
-- ============================================

-- Drop all project policies
DROP POLICY IF EXISTS "Users can view projects they own or are members of" ON projects;
DROP POLICY IF EXISTS "Users can create their own projects" ON projects;
DROP POLICY IF EXISTS "Project owners can update their projects" ON projects;
DROP POLICY IF EXISTS "Project owners can delete their projects" ON projects;

-- Drop all project_members policies
DROP POLICY IF EXISTS "Users can view project members for projects they have access to" ON project_members;
DROP POLICY IF EXISTS "Project owners can manage members" ON project_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can view all members" ON project_members;
DROP POLICY IF EXISTS "Project owners can add members" ON project_members;
DROP POLICY IF EXISTS "Project owners can update members" ON project_members;
DROP POLICY IF EXISTS "Project owners can delete members" ON project_members;

-- ============================================
-- STEP 2: Create correct projects policies
-- ============================================

-- Users can view projects they own or are members of
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

-- Users can create their own projects
CREATE POLICY "Users can create their own projects"
  ON projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Project owners can update their projects
CREATE POLICY "Project owners can update their projects"
  ON projects FOR UPDATE
  USING (owner_id = auth.uid());

-- Project owners can delete their projects
CREATE POLICY "Project owners can delete their projects"
  ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- ============================================
-- STEP 3: Create correct project_members policies
-- ============================================

-- Users can view their own memberships (NO RECURSION - direct user_id check)
CREATE POLICY "Users can view their own memberships"
  ON project_members FOR SELECT
  USING (user_id = auth.uid());

-- Project owners can view members (checks projects.owner_id directly, no recursion)
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

-- ============================================
-- STEP 4: Verify policies were created
-- ============================================

-- List all policies on projects table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'projects'
ORDER BY policyname;

-- List all policies on project_members table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'project_members'
ORDER BY policyname;
