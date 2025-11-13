-- FUNCTION-BASED RLS FIX
-- Use a SECURITY DEFINER function to bypass RLS in the policy check

-- ============================================
-- Step 1: Create a security definer function
-- ============================================

CREATE OR REPLACE FUNCTION is_project_member(project_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_id = project_uuid
    AND user_id = user_uuid
  );
$$;

-- ============================================
-- Step 2: Update projects SELECT policy to use the function
-- ============================================

DROP POLICY IF EXISTS "Users can view projects they own or are members of" ON projects;

CREATE POLICY "Users can view projects they own or are members of"
  ON projects FOR SELECT
  USING (
    owner_id = auth.uid() OR
    is_project_member(id, auth.uid())
  );

-- ============================================
-- Step 3: Simplify project_members policies (no recursion)
-- ============================================

DROP POLICY IF EXISTS "Users can view their own memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can view all members" ON project_members;
DROP POLICY IF EXISTS "Allow read access for authenticated users" ON project_members;

-- Simple policy: users can see memberships for any project they can see
-- Since projects RLS already filters, this won't expose anything sensitive
CREATE POLICY "Users can view project members"
  ON project_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    (SELECT owner_id FROM projects WHERE id = project_members.project_id) = auth.uid()
  );

-- ============================================
-- Step 4: Test the fix
-- ============================================

-- This should work without recursion now
SELECT * FROM projects;
