import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

// GET /api/projects - List all projects for current user
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get projects where user is owner or member
    // Note: RLS policies automatically filter to projects user has access to
    // We don't need to JOIN project_members here as that causes RLS recursion
    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching projects:', error);
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: 500 }
      );
    }

    return NextResponse.json({ projects });
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
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    // Create project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        owner_id: user.id,
      } as any)
      .select()
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
    const { error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_id: projectData.id,
        user_id: user.id,
        role: 'owner',
      } as any);

    if (memberError) {
      console.error('Error adding project member:', memberError);
      // Rollback: delete the project
      await supabase.from('projects').delete().eq('id', projectData.id);
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
