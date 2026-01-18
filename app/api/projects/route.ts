import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';

// GET /api/projects - List all projects for current user
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get projects where user is owner or member
    console.log('[GET /api/projects] Fetching projects for user:', user.id);

    const db = getDatabaseClient();
    const { data: projects, error } = await db
      .from('projects')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .execute();

    if (error) {
      console.error('[GET /api/projects] Error fetching projects:', error);
      return NextResponse.json(
        { error: 'Failed to fetch projects', details: error.message },
        { status: 500 }
      );
    }

    console.log('[GET /api/projects] Successfully fetched', (projects || []).length, 'projects');
    return NextResponse.json({ projects: projects || [] });
  } catch (error) {
    console.error('Error in GET /api/projects:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create new project
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    const db = getDatabaseClient();

    // Create project
    const { data: project, error: projectError } = await db
      .from('projects')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        owner_id: user.id,
      })
      .select('*')
      .single();

    if (projectError) {
      console.error('Error creating project:', projectError);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    const projectData = project as { id: string } | null;
    if (!projectData) {
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    // Add owner as project member
    const { error: memberError } = await db
      .from('project_members')
      .insert({
        project_id: projectData.id,
        user_id: user.id,
        role: 'owner',
      })
      .execute();

    if (memberError) {
      console.error('Error adding project member:', memberError);
      // Rollback: delete the project
      await db.from('projects').delete().eq('id', projectData.id).execute();
      return NextResponse.json(
        { error: 'Failed to create project membership' },
        { status: 500 }
      );
    }

    return NextResponse.json({ project: projectData }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/projects:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
