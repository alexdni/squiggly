// Role-Based Access Control utilities
import type { ProjectRole } from '@/types/database';
import { createClient } from '@/lib/supabase-server';

export type Permission =
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage_members'
  | 'recording:create'
  | 'recording:read'
  | 'recording:delete'
  | 'analysis:create'
  | 'analysis:read'
  | 'analysis:cancel'
  | 'export:create';

// Role permission matrix
const ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  owner: [
    'project:read',
    'project:update',
    'project:delete',
    'project:manage_members',
    'recording:create',
    'recording:read',
    'recording:delete',
    'analysis:create',
    'analysis:read',
    'analysis:cancel',
    'export:create',
  ],
  collaborator: [
    'project:read',
    'recording:create',
    'recording:read',
    'recording:delete',
    'analysis:create',
    'analysis:read',
    'analysis:cancel',
    'export:create',
  ],
  viewer: [
    'project:read',
    'recording:read',
    'analysis:read',
    'export:create',
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: ProjectRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: ProjectRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Get user's role in a project
 */
export async function getUserProjectRole(
  projectId: string,
  userId: string
): Promise<ProjectRole | null> {
  const supabase = await createClient();

  // Check if user is the owner
  const { data: project } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .single();

  if (project?.owner_id === userId) {
    return 'owner';
  }

  // Check if user is a member
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();

  return membership?.role as ProjectRole | null;
}

/**
 * Check if user has permission for a project action
 */
export async function checkProjectPermission(
  projectId: string,
  userId: string,
  permission: Permission
): Promise<boolean> {
  const role = await getUserProjectRole(projectId, userId);

  if (!role) {
    return false;
  }

  return hasPermission(role, permission);
}

/**
 * Require permission or throw error (for API routes)
 */
export async function requireProjectPermission(
  projectId: string,
  userId: string,
  permission: Permission
): Promise<void> {
  const hasAccess = await checkProjectPermission(projectId, userId, permission);

  if (!hasAccess) {
    throw new Error(`Insufficient permissions: ${permission} required`);
  }
}

/**
 * Get all projects accessible to a user
 */
export async function getUserProjects(userId: string) {
  const supabase = await createClient();

  // Get owned projects
  const { data: ownedProjects } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', userId);

  // Get member projects
  const { data: memberships } = await supabase
    .from('project_members')
    .select('project_id, role, projects(*)')
    .eq('user_id', userId);

  const memberProjects = memberships?.map((m) => ({
    ...m.projects,
    role: m.role,
  }));

  return {
    owned: ownedProjects ?? [],
    member: memberProjects ?? [],
    all: [...(ownedProjects ?? []), ...(memberProjects?.map(p => p.projects) ?? [])],
  };
}

/**
 * Validate role assignment (ensure valid role transitions)
 */
export function canAssignRole(
  assignerRole: ProjectRole,
  targetRole: ProjectRole
): boolean {
  // Only owners can assign roles
  if (assignerRole !== 'owner') {
    return false;
  }

  // Owners can assign any role
  return true;
}

/**
 * Get user display info for a project member
 */
export async function getProjectMembers(projectId: string) {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from('project_members')
    .select(`
      id,
      role,
      created_at,
      user_id
    `)
    .eq('project_id', projectId);

  return members ?? [];
}

/**
 * Check if user can access a recording
 */
export async function canAccessRecording(
  recordingId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: recording } = await supabase
    .from('recordings')
    .select('project_id')
    .eq('id', recordingId)
    .single();

  if (!recording) {
    return false;
  }

  return await checkProjectPermission(
    recording.project_id,
    userId,
    'recording:read'
  );
}

/**
 * Check if user can access an analysis
 */
export async function canAccessAnalysis(
  analysisId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: analysis } = await supabase
    .from('analyses')
    .select('recordings(project_id)')
    .eq('id', analysisId)
    .single();

  if (!analysis?.recordings) {
    return false;
  }

  return await checkProjectPermission(
    (analysis.recordings as any).project_id,
    userId,
    'analysis:read'
  );
}
