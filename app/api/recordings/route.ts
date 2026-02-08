import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission, canAccessRecording } from '@/lib/rbac';
import { validateEDFMontage } from '@/lib/edf-validator';
import { DEFAULT_ANALYSIS_CONFIG } from '@/lib/constants';

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

// POST /api/recordings - Create recording and validate montage, or create analysis for existing recording
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Handle creating analysis for existing recording
    if (body.recordingId && body.createAnalysis) {
      return await createAnalysisForRecording(body.recordingId, user.id);
    }

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

    const db = getDatabaseClient();
    const storage = getStorageClient();

    // Check for duplicates (filename + size + recent timestamp)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: existingRecordings } = await db
      .from('recordings')
      .select('id')
      .eq('project_id', projectId)
      .eq('filename', filename)
      .eq('file_size', fileSize)
      .gte('created_at', oneHourAgo)
      .execute();

    if (existingRecordings && existingRecordings.length > 0) {
      return NextResponse.json(
        {
          error: 'Duplicate file detected',
          message: 'A file with the same name and size was uploaded recently',
        },
        { status: 409 }
      );
    }

    // Download file from storage for validation
    let fileBuffer: Buffer;
    try {
      fileBuffer = await storage.download('recordings', filePath);
    } catch (downloadError) {
      console.error('Failed to download file for validation:', downloadError);
      return NextResponse.json(
        { error: 'Failed to download file for validation' },
        { status: 500 }
      );
    }

    // Detect file type from extension
    const fileExtension = filename.toLowerCase().split('.').pop();
    let validationResult;

    if (fileExtension === 'csv') {
      console.log('[Recording] Validating CSV file');
      const { validateCSVFile } = await import('@/lib/csv-validator');
      validationResult = await validateCSVFile(fileBuffer);
    } else if (fileExtension === 'edf') {
      console.log('[Recording] Validating EDF file');
      validationResult = await validateEDFMontage(fileBuffer);
    } else {
      return NextResponse.json(
        {
          error: 'Unsupported file format',
          message: `File type .${fileExtension} is not supported. Only .edf and .csv files are allowed.`,
        },
        { status: 400 }
      );
    }

    if (!validationResult.valid) {
      // Delete uploaded file from storage
      await storage.remove('recordings', [filePath]);

      return NextResponse.json(
        {
          error: `Invalid ${fileExtension?.toUpperCase()} file`,
          message: validationResult.error,
        },
        { status: 400 }
      );
    }

    const metadata = validationResult.metadata!;

    // Auto-detect EO/EC from annotations or filename if not manual
    let finalEoStart = eoStart;
    let finalEoEnd = eoEnd;
    let finalEcStart = ecStart;
    let finalEcEnd = ecEnd;
    let finalEoLabel = eoLabel;
    let finalEcLabel = ecLabel;

    if (!useManual) {
      console.log(`[Auto-detect] Attempting auto-detection for file: ${filename}`);

      // First, try to detect from filename
      const isEOFile = /\beo\b/i.test(filename);
      const isECFile = /\bec\b/i.test(filename);

      if (isEOFile && !isECFile) {
        finalEoStart = 0;
        finalEoEnd = metadata.duration_seconds;
        finalEoLabel = 'EO';
        console.log(`[Auto-detect] ✓ Auto-detected EO file from filename`);
      } else if (isECFile && !isEOFile) {
        finalEcStart = 0;
        finalEcEnd = metadata.duration_seconds;
        finalEcLabel = 'EC';
        console.log(`[Auto-detect] ✓ Auto-detected EC file from filename`);
      } else if (metadata.annotations && metadata.annotations.length > 0) {
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
    }

    // Determine condition type based on EO/EC segments
    const hasEO = finalEoStart !== null && finalEoStart !== undefined && finalEoEnd !== null && finalEoEnd !== undefined;
    const hasEC = finalEcStart !== null && finalEcStart !== undefined && finalEcEnd !== null && finalEcEnd !== undefined;

    let conditionType: 'EO' | 'EC' | 'BOTH' = 'BOTH';
    if (hasEO && !hasEC) {
      conditionType = 'EO';
    } else if (hasEC && !hasEO) {
      conditionType = 'EC';
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
      condition_type: conditionType,
      eo_label: finalEoLabel || null,
      ec_label: finalEcLabel || null,
      eo_start: finalEoStart ?? null,
      eo_end: finalEoEnd ?? null,
      ec_start: finalEcStart ?? null,
      ec_end: finalEcEnd ?? null,
      uploaded_by: user.id,
    };

    const { data: recording, error: insertError } = await db
      .from('recordings')
      .insert(recordingData)
      .select('*')
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

    const { data: analysis, error: analysisError } = await db
      .from('analyses')
      .insert(analysisData)
      .select('*')
      .single();

    if (analysisError) {
      console.error('Error creating analysis:', analysisError);
    }

    const analysisResult = analysis as any;

    return NextResponse.json({
      recording,
      analysis: analysis || null,
      metadata,
      analysisStarted: false,
    });
  } catch (error) {
    console.error('Error creating recording:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to create analysis for an existing recording
async function createAnalysisForRecording(recordingId: string, userId: string) {
  const db = getDatabaseClient();

  // Check if user can access this recording
  const canAccess = await canAccessRecording(recordingId, userId);
  if (!canAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Check if an analysis already exists
  const { data: existingAnalyses } = await db
    .from('analyses')
    .select('id')
    .eq('recording_id', recordingId)
    .execute();

  if (existingAnalyses && existingAnalyses.length > 0) {
    // Return existing analysis
    return NextResponse.json({
      analysis: existingAnalyses[0],
      message: 'Analysis already exists',
    });
  }

  // Create new analysis
  const analysisData: any = {
    recording_id: recordingId,
    status: 'pending',
    config: DEFAULT_ANALYSIS_CONFIG,
  };

  const { data: analysis, error: analysisError } = await db
    .from('analyses')
    .insert(analysisData)
    .select('*')
    .single();

  if (analysisError) {
    console.error('Error creating analysis:', analysisError);
    return NextResponse.json(
      { error: 'Failed to create analysis' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    analysis: analysis as any,
    message: 'Analysis created',
  });
}

// GET /api/recordings - List recordings for a project or get a specific recording
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || searchParams.get('project_id');
    const recordingId = searchParams.get('recordingId') || searchParams.get('recording_id');
    const includeAnalyses = searchParams.get('include_analyses') === 'true';

    const db = getDatabaseClient();

    // Handle fetching by recording_id
    if (recordingId) {
      // Check if user can access this recording
      const canAccess = await canAccessRecording(recordingId, user.id);
      if (!canAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const { data: recording, error } = await db
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .single();

      if (error || !recording) {
        return NextResponse.json(
          { error: 'Recording not found' },
          { status: 404 }
        );
      }

      let analyses: any[] = [];
      if (includeAnalyses) {
        const { data: analysesData } = await db
          .from('analyses')
          .select('*')
          .eq('recording_id', recordingId)
          .order('created_at', { ascending: false })
          .execute();
        analyses = analysesData || [];
      }

      return NextResponse.json({
        recordings: [{
          ...recording,
          analyses: includeAnalyses ? analyses : undefined,
        }],
      });
    }

    // Handle fetching by project_id
    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId or recordingId is required' },
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

    const { data: recordings, error } = await db
      .from('recordings')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .execute();

    if (error) {
      throw error;
    }

    // Optionally include analyses for each recording
    let recordingsWithAnalyses = recordings || [];
    if (includeAnalyses && recordingsWithAnalyses.length > 0) {
      recordingsWithAnalyses = await Promise.all(
        recordingsWithAnalyses.map(async (rec: any) => {
          const { data: analyses } = await db
            .from('analyses')
            .select('*')
            .eq('recording_id', rec.id)
            .order('created_at', { ascending: false })
            .execute();
          return { ...rec, analyses: analyses || [] };
        })
      );
    }

    return NextResponse.json({ recordings: recordingsWithAnalyses });
  } catch (error) {
    console.error('Error fetching recordings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
