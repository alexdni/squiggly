# Fix RLS Infinite Recursion Error

## Error
```
Error fetching projects: {
  code: '42P17',
  message: 'infinite recursion detected in policy for relation "project_members"'
}
```

## Cause
The RLS policies on `project_members` and `projects` tables create a circular dependency when using INNER JOINs:

1. **projects SELECT policy** checks if user is in `project_members`
2. **API route** uses `project_members!inner()` JOIN
3. **project_members SELECT policy** needs to evaluate the join
4. This creates infinite recursion as both policies try to evaluate each other

The key issue: **INNER JOINs force both tables' RLS policies to evaluate simultaneously**

## Solution

**Two-part fix:**
1. ✅ Simplify RLS policies (SQL migration) - Already done
2. ✅ Remove INNER JOIN from API route - Fixed in latest commit

### The Real Fix: Remove the INNER JOIN

The actual solution was **removing the INNER JOIN** from the API route. Since the RLS policy on `projects` already filters by project membership, we don't need to explicitly JOIN `project_members` in the query.

**Code Change (already deployed):**
```typescript
// BEFORE (caused recursion)
const { data: projects } = await supabase
  .from('projects')
  .select(`
    *,
    project_members!inner(role, user_id)  // ⚠️ INNER JOIN triggers recursion
  `)
  .eq('project_members.user_id', user.id);

// AFTER (fixed)
const { data: projects } = await supabase
  .from('projects')
  .select('*');  // ✅ RLS policy handles filtering automatically
```

### Why This Works

The `projects` table RLS policy already does:
```sql
USING (
  owner_id = auth.uid() OR
  EXISTS (SELECT 1 FROM project_members WHERE ...)
)
```

So when you query `projects`, RLS automatically:
1. Filters to projects you own
2. Filters to projects where you're a member
3. **Without triggering the project_members RLS policy**

Adding an INNER JOIN forces **both** RLS policies to evaluate, causing recursion.

### Deploy Instructions

**The fix is already deployed!** Just pull the latest code:

```bash
git pull origin main
# Vercel will auto-deploy
```

No SQL migration needed - the code fix resolves the issue.

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
