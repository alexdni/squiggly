import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission, canAssignRole, getUserProjectRole } from '@/lib/rbac';
import type { ProjectRole } from '@/types/database';

// GET /api/projects/:id/members - List project members
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = params.id;

    // Check if user has permission to view members
    const hasAccess = await checkProjectPermission(
      projectId,
      user.id,
      'project:read'
    );

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get project owner
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get all members
    const { data: members, error } = await supabase
      .from('project_members')
      .select('id, user_id, role, created_at')
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    // Type assertion for project data
    const projectData = project as { owner_id: string };

    // Include owner in the list
    const allMembers = [
      {
        id: 'owner',
        user_id: projectData.owner_id,
        role: 'owner' as ProjectRole,
        created_at: null as string | null,
      },
      ...(members || []),
    ];

    return NextResponse.json({ members: allMembers });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:id/members - Add a member to project
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = params.id;
    const body = await request.json();
    const { user_id: targetUserId, role } = body;

    if (!targetUserId || !role) {
      return NextResponse.json(
        { error: 'user_id and role are required' },
        { status: 400 }
      );
    }

    // Validate role
    if (!['owner', 'collaborator', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if current user has permission to manage members
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'project:manage_members'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get current user's role
    const currentUserRole = await getUserProjectRole(projectId, user.id);

    if (!currentUserRole) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if current user can assign this role
    if (!canAssignRole(currentUserRole, role)) {
      return NextResponse.json(
        { error: 'Cannot assign this role' },
        { status: 403 }
      );
    }

    // Add member - explicit type for insert
    const insertData: any = {
      project_id: projectId,
      user_id: targetUserId,
      role: role as ProjectRole,
    };

    const { data: member, error } = await supabase
      .from('project_members')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        return NextResponse.json(
          { error: 'User is already a member' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    console.error('Error adding member:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:id/members/:memberId - Remove a member
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = params.id;
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!memberId) {
      return NextResponse.json(
        { error: 'memberId is required' },
        { status: 400 }
      );
    }

    // Check if current user has permission to manage members
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'project:manage_members'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Remove member
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('id', memberId)
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
