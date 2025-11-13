import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * POST /api/recordings/[id]/detect-segments
 *
 * Auto-detect and update EO/EC segments for an existing recording
 * Useful for files uploaded before auto-detection was implemented
 */
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

    // Fetch the recording
    const { data: recording, error: fetchError } = await supabase
      .from('recordings')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      );
    }

    // Auto-detect from filename
    const filename = recording.filename;
    const filenameLower = filename.toLowerCase();
    const duration = recording.duration_seconds;

    const isEOFile = filenameLower.includes(' eo ') ||
                     filenameLower.includes('_eo_') ||
                     filenameLower.includes('-eo-') ||
                     filenameLower.includes(' eo.') ||
                     /\beo\b/i.test(filename);
    const isECFile = filenameLower.includes(' ec ') ||
                     filenameLower.includes('_ec_') ||
                     filenameLower.includes('-ec-') ||
                     filenameLower.includes(' ec.') ||
                     /\bec\b/i.test(filename);

    let updates: any = {};
    let detectedType = 'unknown';

    if (isEOFile && !isECFile) {
      // Entire file is Eyes Open
      updates = {
        eo_start: 0,
        eo_end: duration,
        eo_label: 'EO',
        ec_start: null,
        ec_end: null,
        ec_label: null,
      };
      detectedType = 'EO';
    } else if (isECFile && !isEOFile) {
      // Entire file is Eyes Closed
      updates = {
        eo_start: null,
        eo_end: null,
        eo_label: null,
        ec_start: 0,
        ec_end: duration,
        ec_label: 'EC',
      };
      detectedType = 'EC';
    } else {
      return NextResponse.json(
        {
          error: 'Could not auto-detect EO/EC from filename',
          message: 'Filename should contain "EO" or "EC"',
          filename
        },
        { status: 400 }
      );
    }

    // Update the recording
    const { data: updated, error: updateError } = await supabase
      .from('recordings')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating recording:', updateError);
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      detectedType,
      recording: updated,
      message: `Auto-detected ${detectedType} from filename and set segments (0s to ${duration}s)`
    });

  } catch (error: any) {
    console.error('Error detecting segments:', error);
    return NextResponse.json(
      { error: 'Failed to detect segments' },
      { status: 500 }
    );
  }
}
