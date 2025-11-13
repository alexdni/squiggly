-- Setup Storage Buckets and Policies for Squiggly

-- ============================================
-- Step 1: Create storage buckets (if they don't exist)
-- ============================================

-- Create recordings bucket (private - only accessible to project members)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recordings',
  'recordings',
  false,  -- private bucket
  52428800,  -- 50 MB limit
  ARRAY['application/octet-stream', 'application/x-edf', 'application/edf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/octet-stream', 'application/x-edf', 'application/edf'];

-- Create visuals bucket (private - only accessible to project members)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'visuals',
  'visuals',
  false,  -- private bucket
  10485760,  -- 10 MB limit
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg'];

-- Create exports bucket (private - only accessible to project members)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exports',
  'exports',
  false,  -- private bucket
  104857600,  -- 100 MB limit
  ARRAY['application/pdf', 'application/zip', 'application/json']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 104857600,
  allowed_mime_types = ARRAY['application/pdf', 'application/zip', 'application/json'];

-- ============================================
-- Step 2: Create storage policies for recordings bucket
-- ============================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can upload recordings to their projects" ON storage.objects;
DROP POLICY IF EXISTS "Users can view recordings in their projects" ON storage.objects;
DROP POLICY IF EXISTS "Users can update recordings in their projects" ON storage.objects;
DROP POLICY IF EXISTS "Project owners can delete recordings" ON storage.objects;

-- Allow authenticated users to upload to recordings bucket
-- The file path must be: projectId/filename
-- We check if the user has access to the project
CREATE POLICY "Users can upload recordings to their projects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'recordings' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

-- Allow users to view recordings in projects they have access to
CREATE POLICY "Users can view recordings in their projects"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recordings' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

-- Allow users to update recordings in projects they have write access to
CREATE POLICY "Users can update recordings in their projects"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'recordings' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'collaborator')
  )
);

-- Allow project owners to delete recordings
CREATE POLICY "Project owners can delete recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'recordings' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
  )
);

-- ============================================
-- Step 3: Create storage policies for visuals bucket
-- ============================================

CREATE POLICY "Users can view visuals in their projects"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'visuals' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Workers can upload visuals"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'visuals' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

-- ============================================
-- Step 4: Create storage policies for exports bucket
-- ============================================

CREATE POLICY "Users can view exports in their projects"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'exports' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can upload exports in their projects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'exports' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id::text FROM project_members WHERE user_id = auth.uid()
  )
);

-- ============================================
-- Step 5: Verify buckets and policies
-- ============================================

-- List all buckets
SELECT * FROM storage.buckets ORDER BY name;

-- List all storage policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
