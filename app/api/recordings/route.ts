import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { DEFAULT_ANALYSIS_CONFIG } from '@/lib/constants';

const execAsync = promisify(exec);

interface RecordingMetadata {
  duration_seconds: number;
  sampling_rate: number;
  n_channels: number;
  channels: string[];
  annotations: Array<{
    onset: number;
    duration: number;
    description: string;
  }>;
}

// POST /api/recordings - Create recording and validate montage
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
    const {
      projectId,
      filename,
      filePath,
      fileSize,
      eoLabel,
      ecLabel,
      eoStart,
      eoEnd,
      ecStart,
      ecEnd,
      useManual,
    } = body;

    if (!projectId || !filename || !filePath || !fileSize) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check permission
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'recording:create'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check for duplicates (filename + size + recent timestamp)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: existingRecordings } = await supabase
      .from('recordings')
      .select('id')
      .eq('project_id', projectId)
      .eq('filename', filename)
      .eq('file_size', fileSize)
      .gte('created_at', oneHourAgo);

    if (existingRecordings && existingRecordings.length > 0) {
      return NextResponse.json(
        {
          error: 'Duplicate file detected',
          message: 'A file with the same name and size was uploaded recently',
        },
        { status: 409 }
      );
    }

    // Download file from Supabase Storage for validation
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('recordings')
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: 'Failed to download file for validation' },
        { status: 500 }
      );
    }

    // Save temporarily for Python validation
    const tempDir = '/tmp';
    const tempFilePath = path.join(tempDir, `validate-${Date.now()}.edf`);

    // Write file to temp location
    const fs = require('fs').promises;
    const buffer = Buffer.from(await fileData.arrayBuffer());
    await fs.writeFile(tempFilePath, buffer);

    try {
      // Run lightweight Python validation script (no MNE dependency)
      const scriptPath = path.join(process.cwd(), 'api/workers/validate_montage_lite.py');
      const { stdout, stderr } = await execAsync(`python3 ${scriptPath} ${tempFilePath}`);

      if (stderr) {
        console.error('Validation stderr:', stderr);
      }

      const validationResult: {
        valid: boolean;
        error?: string;
        metadata?: RecordingMetadata;
      } = JSON.parse(stdout);

      // Clean up temp file
      await fs.unlink(tempFilePath);

      if (!validationResult.valid) {
        // Delete uploaded file from storage
        await supabase.storage.from('recordings').remove([filePath]);

        return NextResponse.json(
          {
            error: 'Invalid EDF file',
            message: validationResult.error,
          },
          { status: 400 }
        );
      }

      const metadata = validationResult.metadata!;

      // Auto-detect EO/EC from annotations if not manual
      let finalEoStart = eoStart;
      let finalEoEnd = eoEnd;
      let finalEcStart = ecStart;
      let finalEcEnd = ecEnd;
      let finalEoLabel = eoLabel;
      let finalEcLabel = ecLabel;

      if (!useManual && metadata.annotations) {
        // Try to find EO/EC annotations
        const eoAnnotation = metadata.annotations.find((ann) =>
          ['EO', 'eo', 'eyes open', 'Eyes Open', 'EYES OPEN'].includes(ann.description)
        );
        const ecAnnotation = metadata.annotations.find((ann) =>
          ['EC', 'ec', 'eyes closed', 'Eyes Closed', 'EYES CLOSED'].includes(ann.description)
        );

        if (eoAnnotation) {
          finalEoStart = eoAnnotation.onset;
          finalEoEnd = eoAnnotation.onset + eoAnnotation.duration;
          finalEoLabel = eoAnnotation.description;
        }

        if (ecAnnotation) {
          finalEcStart = ecAnnotation.onset;
          finalEcEnd = ecAnnotation.onset + ecAnnotation.duration;
          finalEcLabel = ecAnnotation.description;
        }
      }

      // Create recording entry
      const recordingData: any = {
        project_id: projectId,
        filename: filename,
        file_path: filePath,
        file_size: fileSize,
        duration_seconds: metadata.duration_seconds,
        sampling_rate: metadata.sampling_rate,
        n_channels: metadata.n_channels,
        montage: '10-20',
        reference: 'LE',
        eo_label: finalEoLabel || null,
        ec_label: finalEcLabel || null,
        eo_start: finalEoStart || null,
        eo_end: finalEoEnd || null,
        ec_start: finalEcStart || null,
        ec_end: finalEcEnd || null,
        uploaded_by: user.id,
      };

      const { data: recording, error: insertError } = await supabase
        .from('recordings')
        .insert(recordingData)
        .select()
        .single();

      if (insertError) {
        console.error('Error inserting recording:', insertError);
        throw insertError;
      }

      const recordingResult = recording as any;

      // Create analysis job with default config
      const analysisData: any = {
        recording_id: recordingResult.id,
        status: 'pending',
        config: DEFAULT_ANALYSIS_CONFIG,
      };

      const { data: analysis, error: analysisError } = await supabase
        .from('analyses')
        .insert(analysisData)
        .select()
        .single();

      if (analysisError) {
        console.error('Error creating analysis:', analysisError);
        // Don't fail the request, just log the error
      }

      return NextResponse.json({
        recording,
        analysis: analysis || null,
        metadata,
      });
    } catch (error: any) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempFilePath);
      } catch {}

      throw error;
    }
  } catch (error) {
    console.error('Error creating recording:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/recordings - List recordings for a project
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Check permission
    const hasPermission = await checkProjectPermission(
      projectId,
      user.id,
      'recording:read'
    );

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: recordings, error } = await supabase
      .from('recordings')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ recordings });
  } catch (error) {
    console.error('Error fetching recordings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
