# Fix RLS Infinite Recursion Error

## Error
```
Error fetching projects: {
  code: '42P17',
  message: 'infinite recursion detected in policy for relation "project_members"'
}
```

## Cause
The RLS policies on `project_members` and `projects` tables create a circular dependency:

1. **projects SELECT policy** checks if user is in `project_members`
2. **project_members SELECT policy** checks if user has access to `projects`
3. This creates infinite recursion when querying with joins

## Solution

Run the SQL migration in Supabase to fix the policies.

### Steps to Fix

1. **Go to Supabase Dashboard**
   - Navigate to your project
   - Click on "SQL Editor" in the left sidebar

2. **Run the migration**
   - Click "New Query"
   - Copy the contents of `supabase/fix_rls_recursion.sql`
   - Paste into the SQL editor
   - Click "Run"

3. **Verify the fix**
   - Go back to your app
   - Try creating a project again
   - Should work without recursion error

## What Changed

### Before (Problematic)
```sql
-- project_members SELECT policy queried projects
CREATE POLICY "Users can view project members..."
  ON project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects  -- ⚠️ This queries projects
      WHERE ...
      AND EXISTS (
        SELECT 1 FROM project_members pm2  -- ⚠️ Which queries project_members again
        ...
      )
    )
  );
```

### After (Fixed)
```sql
-- Separate policies: one for own memberships, one for owned projects
CREATE POLICY "Users can view their own memberships"
  ON project_members FOR SELECT
  USING (user_id = auth.uid());  -- ✅ Direct check, no join

CREATE POLICY "Project owners can view all members"
  ON project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()  -- ✅ Direct owner check, no recursion
    )
  );
```

## Key Principles

1. **Avoid circular JOINs** between tables with RLS
2. **Use direct auth.uid() checks** when possible
3. **Split policies** by use case (own records vs. owned projects)
4. **Test with complex queries** (especially JOINs with `!inner`)

## Testing

After applying the fix, test these scenarios:

1. ✅ Create a new project
2. ✅ View list of projects (GET /api/projects)
3. ✅ Add members to a project
4. ✅ Upload a recording to a project
5. ✅ View recordings across multiple projects

All should work without recursion errors.

## Future: If Adding More RLS Policies

When adding new policies that involve JOINs:

1. **Map out the dependency graph** (which table policies query which tables)
2. **Check for cycles** (A → B → A)
3. **Break cycles** by using direct checks or split policies
4. **Test with realistic queries** including JOINs

---

**Updated Files:**
- [supabase/fix_rls_recursion.sql](supabase/fix_rls_recursion.sql) - Migration to fix existing database
- [supabase/schema.sql](supabase/schema.sql) - Updated for future deployments
