import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectAccess } from '@/lib/rbac';
import type { ClientMetadata, Gender } from '@/types/database';

/**
 * Update project client metadata
 * PATCH /api/projects/:id/metadata
 */
export async function PATCH(
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

    // Check if user has write access (owner or collaborator)
    const hasAccess = await checkProjectAccess(
      supabase,
      params.id,
      user.id,
      ['owner', 'collaborator']
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to edit this project' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const metadata: ClientMetadata = {};

    // Validate and sanitize metadata fields
    if (body.diagnosis !== undefined) {
      metadata.diagnosis = String(body.diagnosis).trim();
    }

    if (body.primary_issue !== undefined) {
      metadata.primary_issue = String(body.primary_issue).trim();
    }

    if (body.secondary_issue !== undefined) {
      metadata.secondary_issue = body.secondary_issue
        ? String(body.secondary_issue).trim()
        : undefined;
    }

    if (body.gender !== undefined) {
      const validGenders: Gender[] = ['male', 'female', 'other', 'unknown'];
      if (!validGenders.includes(body.gender)) {
        return NextResponse.json(
          { error: 'Invalid gender value. Must be one of: male, female, other, unknown' },
          { status: 400 }
        );
      }
      metadata.gender = body.gender as Gender;
    }

    if (body.age !== undefined) {
      const age = Number(body.age);
      if (isNaN(age) || age < 0 || age > 150) {
        return NextResponse.json(
          { error: 'Age must be between 0 and 150' },
          { status: 400 }
        );
      }
      metadata.age = age;
    }

    if (body.interventions !== undefined) {
      if (Array.isArray(body.interventions)) {
        metadata.interventions = body.interventions
          .map((i) => String(i).trim())
          .filter((i) => i.length > 0);
      } else if (typeof body.interventions === 'string') {
        // Support comma-separated string input
        metadata.interventions = body.interventions
          .split(',')
          .map((i) => i.trim())
          .filter((i) => i.length > 0);
      } else {
        return NextResponse.json(
          { error: 'Interventions must be an array or comma-separated string' },
          { status: 400 }
        );
      }
    }

    // Update project metadata
    const { data: project, error: updateError } = await (supabase as any)
      .from('projects')
      .update({
        client_metadata: metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating project metadata:', updateError);
      return NextResponse.json(
        { error: 'Failed to update project metadata' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (error: any) {
    console.error('Error in PATCH /api/projects/:id/metadata:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get project client metadata
 * GET /api/projects/:id/metadata
 */
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

    // Check if user has read access (owner, collaborator, or viewer)
    const hasAccess = await checkProjectAccess(
      supabase,
      params.id,
      user.id,
      ['owner', 'collaborator', 'viewer']
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have access to this project' },
        { status: 403 }
      );
    }

    const { data: project, error: fetchError } = await (supabase as any)
      .from('projects')
      .select('id, client_metadata')
      .eq('id', params.id)
      .single();

    if (fetchError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      client_metadata: project.client_metadata || {},
    });
  } catch (error: any) {
    console.error('Error in GET /api/projects/:id/metadata:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
