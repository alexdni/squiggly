import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { checkProjectPermission } from '@/lib/rbac';
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

    // Convert to buffer for validation
    const buffer = Buffer.from(await fileData.arrayBuffer());

    // Detect file type from extension
    const fileExtension = filename.toLowerCase().split('.').pop();
    let validationResult;

    if (fileExtension === 'csv') {
      console.log('[Recording] Validating CSV file');
      const { validateCSVFile } = await import('@/lib/csv-validator');
      validationResult = await validateCSVFile(buffer);
    } else if (fileExtension === 'edf') {
      console.log('[Recording] Validating EDF file');
      validationResult = await validateEDFMontage(buffer);
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
      await supabase.storage.from('recordings').remove([filePath]);

      return NextResponse.json(
        {
          error: `Invalid ${fileExtension.toUpperCase()} file`,
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
      console.log(`[Auto-detect] useManual flag: ${useManual}`);

      // First, try to detect from filename
      // Use word boundary regex to match EO/EC as standalone words
      const isEOFile = /\beo\b/i.test(filename);
      const isECFile = /\bec\b/i.test(filename);

      console.log(`[Auto-detect] Filename check - isEOFile: ${isEOFile}, isECFile: ${isECFile}`);

      // If filename indicates entire file is EO or EC, set times accordingly
      if (isEOFile && !isECFile) {
        // Entire file is Eyes Open
        finalEoStart = 0;
        finalEoEnd = metadata.duration_seconds;
        finalEoLabel = 'EO';
        console.log(`[Auto-detect] ✓ Auto-detected EO file from filename: ${filename}, duration: ${metadata.duration_seconds}s`);
      } else if (isECFile && !isEOFile) {
        // Entire file is Eyes Closed
        finalEcStart = 0;
        finalEcEnd = metadata.duration_seconds;
        finalEcLabel = 'EC';
        console.log(`[Auto-detect] ✓ Auto-detected EC file from filename: ${filename}, duration: ${metadata.duration_seconds}s`);
      } else {
        // Filename detection failed, try EDF annotations
        console.log(`[Auto-detect] Filename detection failed (both or neither matched), checking annotations...`);
        console.log(`[Auto-detect] Number of annotations: ${metadata.annotations?.length || 0}`);

        if (metadata.annotations && metadata.annotations.length > 0) {
          console.log(`[Auto-detect] Available annotations:`, metadata.annotations.map(a => a.description));

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
            console.log(`[Auto-detect] ✓ Found EO annotation: onset=${eoAnnotation.onset}s, duration=${eoAnnotation.duration}s`);
          }

          if (ecAnnotation) {
            finalEcStart = ecAnnotation.onset;
            finalEcEnd = ecAnnotation.onset + ecAnnotation.duration;
            finalEcLabel = ecAnnotation.description;
            console.log(`[Auto-detect] ✓ Found EC annotation: onset=${ecAnnotation.onset}s, duration=${ecAnnotation.duration}s`);
          }

          if (!eoAnnotation && !ecAnnotation) {
            console.log(`[Auto-detect] ✗ No matching EO/EC annotations found`);
          }
        } else {
          console.log(`[Auto-detect] ✗ No annotations in EDF file`);
        }
      }

      // Final check
      const hasEO = finalEoStart !== undefined && finalEoEnd !== undefined;
      const hasEC = finalEcStart !== undefined && finalEcEnd !== undefined;
      console.log(`[Auto-detect] Final result - hasEO: ${hasEO}, hasEC: ${hasEC}`);

      if (!hasEO && !hasEC) {
        console.log(`[Auto-detect] ✗ Auto-detection completely failed - no segments labeled`);
      }
    } else {
      console.log(`[Auto-detect] Manual mode enabled, skipping auto-detection`);
    }

    // Determine condition type based on EO/EC segments
    const hasEO = finalEoStart !== null && finalEoStart !== undefined && finalEoEnd !== null && finalEoEnd !== undefined;
    const hasEC = finalEcStart !== null && finalEcStart !== undefined && finalEcEnd !== null && finalEcEnd !== undefined;

    let conditionType: 'EO' | 'EC' | 'BOTH' = 'BOTH';
    if (hasEO && !hasEC) {
      conditionType = 'EO';
    } else if (hasEC && !hasEO) {
      conditionType = 'EC';
    } else if (hasEO && hasEC) {
      conditionType = 'BOTH';
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
      eo_start: finalEoStart ?? null,  // Use ?? to preserve 0 values
      eo_end: finalEoEnd ?? null,
      ec_start: finalEcStart ?? null,
      ec_end: finalEcEnd ?? null,
      uploaded_by: user.id,
    };

    console.log(`[Recording] Saving to database with EO/EC times:`, {
      eo_label: recordingData.eo_label,
      eo_start: recordingData.eo_start,
      eo_end: recordingData.eo_end,
      ec_label: recordingData.ec_label,
      ec_start: recordingData.ec_start,
      ec_end: recordingData.ec_end,
    });

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

    // Cast analysis to any to avoid TypeScript type issues
    const analysisResult = analysis as any;

    // Automatically trigger analysis processing
    let analysisStarted = false;
    if (analysisResult) {
      try {
        console.log(`[Auto-Analysis] Triggering analysis for recording ${recordingResult.id}`);

        const analysisProcessUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/analyses/${analysisResult.id}/process`;

        // Call the analysis processing endpoint asynchronously
        // Don't await to avoid blocking the upload response
        fetch(analysisProcessUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }).then(() => {
          console.log(`[Auto-Analysis] ✓ Analysis processing initiated for ${analysisResult.id}`);
        }).catch((err) => {
          console.error(`[Auto-Analysis] ✗ Failed to trigger analysis:`, err);
        });

        analysisStarted = true;
      } catch (triggerError) {
        console.error('[Auto-Analysis] Error triggering analysis:', triggerError);
        // Continue anyway - user can manually trigger later
      }
    }

    return NextResponse.json({
      recording,
      analysis: analysis || null,
      metadata,
      analysisStarted,
    });
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
