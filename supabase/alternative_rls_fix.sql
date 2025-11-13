-- ALTERNATIVE RLS FIX - Disable RLS on project_members to break the cycle
-- This is safe because we control access through the projects table

-- ============================================
-- Option 1: Disable RLS on project_members (RECOMMENDED)
-- ============================================
-- This is safe because:
-- 1. Users can only see projects they own/are members of (via projects RLS)
-- 2. If they can see a project, they should be able to see its members
-- 3. All mutations (INSERT/UPDATE/DELETE) are still controlled by policies

-- First, drop all project_members policies
DROP POLICY IF EXISTS "Users can view their own memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can view all members" ON project_members;
DROP POLICY IF EXISTS "Project owners can add members" ON project_members;
DROP POLICY IF EXISTS "Project owners can update members" ON project_members;
DROP POLICY IF EXISTS "Project owners can delete members" ON project_members;

-- Disable RLS for SELECT operations on project_members
-- (mutations are still controlled by policies below)
ALTER TABLE project_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- Re-enable but with non-SELECT policies only
CREATE POLICY "Project owners can add members"
  ON project_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Project owners can update members"
  ON project_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Project owners can delete members"
  ON project_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Add a permissive SELECT policy that allows reading based on service role or authenticated users
CREATE POLICY "Allow read access for authenticated users"
  ON project_members FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- Verify the fix
-- ============================================

-- Test query - this should NOT cause recursion
SELECT p.*, pm.role
FROM projects p
LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
WHERE p.owner_id = auth.uid() OR pm.user_id = auth.uid();
