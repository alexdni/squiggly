import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import {
  generateEEGInterpretation,
  AIInterpretation,
} from '@/lib/openai-client';
import {
  EEG_INTERPRETATION_SYSTEM_PROMPT,
  buildUserPrompt,
  EEGDataPayload,
} from '@/lib/prompts/eeg-interpretation';

interface RouteParams {
  params: { id: string };
}

// GET - Retrieve cached AI interpretation
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analysis, error } = await (supabase as any)
      .from('analyses')
      .select('results')
      .eq('id', params.id)
      .single();

    if (error || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    const aiInterpretation = analysis.results?.ai_interpretation;
    if (!aiInterpretation) {
      return NextResponse.json(
        { error: 'No AI interpretation available' },
        { status: 404 }
      );
    }

    return NextResponse.json({ interpretation: aiInterpretation });
  } catch (error: any) {
    console.error('Error fetching AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI interpretation' },
      { status: 500 }
    );
  }
}

// POST - Generate new AI interpretation
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if OPENAI_API_KEY is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'AI interpretation service is not configured' },
        { status: 503 }
      );
    }

    // Fetch analysis with recording and project data
    const { data: analysis, error: fetchError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings (
          id,
          duration_seconds,
          sampling_rate,
          n_channels,
          montage,
          project_id
        )
      `)
      .eq('id', params.id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    // Verify analysis is completed
    if (analysis.status !== 'completed') {
      return NextResponse.json(
        { error: 'Analysis must be completed before generating AI interpretation' },
        { status: 400 }
      );
    }

    // Verify we have results
    if (!analysis.results) {
      return NextResponse.json(
        { error: 'Analysis data is incomplete. Cannot generate AI interpretation.' },
        { status: 400 }
      );
    }

    // Fetch project metadata if available
    let clientMetadata: any = null;
    if (analysis.recording?.project_id) {
      const { data: project } = await (supabase as any)
        .from('projects')
        .select('client_metadata')
        .eq('id', analysis.recording.project_id)
        .single();
      clientMetadata = project?.client_metadata;
    }

    // Build the data payload for the LLM
    const payload: EEGDataPayload = {
      recording_info: {
        duration_seconds: analysis.recording?.duration_seconds || 0,
        sampling_rate: analysis.recording?.sampling_rate || 250,
        n_channels: analysis.recording?.n_channels || 19,
        montage: analysis.recording?.montage || '10-20',
      },
    };

    // Add QC report if available
    if (analysis.results.qc_report) {
      payload.qc_report = {
        artifact_rejection_rate: analysis.results.qc_report.artifact_rejection_rate || 0,
        bad_channels: analysis.results.qc_report.bad_channels || [],
        ica_components_removed: analysis.results.qc_report.ica_components_removed || 0,
        final_epochs_eo: analysis.results.qc_report.final_epochs_eo || 0,
        final_epochs_ec: analysis.results.qc_report.final_epochs_ec || 0,
      };
    }

    // Add band power if available
    if (analysis.results.band_power) {
      payload.band_power = {
        eo: analysis.results.band_power.eo,
        ec: analysis.results.band_power.ec,
      };
    }

    // Add band ratios if available
    if (analysis.results.band_ratios) {
      payload.band_ratios = analysis.results.band_ratios;
    }

    // Add asymmetry if available
    if (analysis.results.asymmetry) {
      payload.asymmetry = analysis.results.asymmetry;
    }

    // Add LZC values if available
    if (analysis.results.lzc) {
      payload.lzc_values = analysis.results.lzc;
    }

    // Add alpha peak frequency if available
    if (analysis.results.alpha_peak) {
      payload.alpha_peak = analysis.results.alpha_peak;
    }

    // Add client metadata if available
    if (clientMetadata) {
      payload.client_metadata = {
        age: clientMetadata.age,
        gender: clientMetadata.gender,
        primary_issue: clientMetadata.primary_issue,
      };
    }

    // Build prompts
    const systemPrompt = EEG_INTERPRETATION_SYSTEM_PROMPT;
    const userPrompt = buildUserPrompt(payload);

    // Generate interpretation via OpenAI
    let interpretationContent;
    try {
      interpretationContent = await generateEEGInterpretation(
        systemPrompt,
        userPrompt,
        60000 // 60 second timeout
      );
    } catch (error: any) {
      console.error('OpenAI API error:', error);

      if (error.message === 'OpenAI request timed out') {
        return NextResponse.json(
          { error: 'AI interpretation timed out. Please try again.' },
          { status: 504 }
        );
      }
      if (error.message === 'OpenAI rate limit exceeded') {
        return NextResponse.json(
          { error: 'AI service is busy. Please try again in a few minutes.' },
          { status: 429 }
        );
      }
      if (error.message === 'OpenAI authentication failed') {
        return NextResponse.json(
          { error: 'AI interpretation service is currently unavailable.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to generate AI interpretation' },
        { status: 500 }
      );
    }

    // Create interpretation object
    const interpretation: AIInterpretation = {
      generated_at: new Date().toISOString(),
      model: 'gpt-4',
      content: interpretationContent,
    };

    // Store interpretation in analysis results
    const updatedResults = {
      ...analysis.results,
      ai_interpretation: interpretation,
    };

    const { error: updateError } = await (supabase as any)
      .from('analyses')
      .update({ results: updatedResults })
      .eq('id', params.id);

    if (updateError) {
      console.error('Error storing AI interpretation:', updateError);
      // Still return the interpretation even if storage failed
    }

    return NextResponse.json({ interpretation });
  } catch (error: any) {
    console.error('Error generating AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI interpretation' },
      { status: 500 }
    );
  }
}
