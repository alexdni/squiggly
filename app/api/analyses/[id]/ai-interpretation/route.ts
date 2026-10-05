import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
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
  params: Promise<{ id: string }>;
}

// GET - Retrieve cached AI interpretation
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: analysisId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDatabaseClient();

    const { data: analysis } = await db
      .from('analyses')
      .select('results')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    const aiInterpretation = (analysis as any).results?.ai_interpretation;
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
    const { id: analysisId } = await params;
    const user = await getCurrentUser();

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

    const db = getDatabaseClient();

    // Fetch analysis
    const { data: analysis } = await db
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (!analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    const analysisData = analysis as any;

    // Verify analysis is completed
    if (analysisData.status !== 'completed') {
      return NextResponse.json(
        { error: 'Analysis must be completed before generating AI interpretation' },
        { status: 400 }
      );
    }

    // Verify we have results
    if (!analysisData.results) {
      return NextResponse.json(
        { error: 'Analysis data is incomplete. Cannot generate AI interpretation.' },
        { status: 400 }
      );
    }

    // Fetch recording data
    const { data: recording } = await db
      .from('recordings')
      .select('id, duration_seconds, sampling_rate, n_channels, montage, project_id')
      .eq('id', analysisData.recording_id)
      .single();

    const recordingData = recording as any;

    // Fetch project metadata if available
    let clientMetadata: any = null;
    if (recordingData?.project_id) {
      const { data: project } = await db
        .from('projects')
        .select('client_metadata')
        .eq('id', recordingData.project_id)
        .single();
      clientMetadata = (project as any)?.client_metadata;
    }

    // Build the data payload for the LLM
    const payload: EEGDataPayload = {
      recording_info: {
        duration_seconds: recordingData?.duration_seconds || 0,
        sampling_rate: recordingData?.sampling_rate || 250,
        n_channels: recordingData?.n_channels || 19,
        montage: recordingData?.montage || '10-20',
      },
    };

    // Add QC report if available
    if (analysisData.results.qc_report) {
      payload.qc_report = {
        artifact_rejection_rate: analysisData.results.qc_report.artifact_rejection_rate || 0,
        bad_channels: analysisData.results.qc_report.bad_channels || [],
        ica_components_removed: analysisData.results.qc_report.ica_components_removed || 0,
        final_epochs_eo: analysisData.results.qc_report.final_epochs_eo || 0,
        final_epochs_ec: analysisData.results.qc_report.final_epochs_ec || 0,
      };
    }

    // Add band power if available
    if (analysisData.results.band_power) {
      payload.band_power = {
        eo: analysisData.results.band_power.eo,
        ec: analysisData.results.band_power.ec,
      };
    }

    // Add band ratios if available
    if (analysisData.results.band_ratios) {
      payload.band_ratios = analysisData.results.band_ratios;
    }

    // Add asymmetry if available
    if (analysisData.results.asymmetry) {
      payload.asymmetry = analysisData.results.asymmetry;
    }

    // Add LZC values if available - extract normalized_lzc from nested structure
    if (analysisData.results.lzc) {
      const lzcPayload: Record<string, Record<string, number>> = {};
      for (const condition of ['eo', 'ec']) {
        const conditionData = analysisData.results.lzc[condition];
        if (conditionData && typeof conditionData === 'object') {
          lzcPayload[condition] = {};
          for (const [ch, data] of Object.entries(conditionData)) {
            const normalizedLzc = (data as any)?.normalized_lzc;
            if (typeof normalizedLzc === 'number' && normalizedLzc > 0) {
              lzcPayload[condition][ch] = normalizedLzc;
            }
          }
        }
      }
      if (Object.keys(lzcPayload).length > 0) {
        payload.lzc_values = lzcPayload;
      }
    }

    // Add alpha peak frequency if available
    if (analysisData.results.alpha_peak) {
      const alphaPeakPayload: { eo?: Record<string, number>; ec?: Record<string, number> } = {};
      for (const condition of ['eo', 'ec'] as const) {
        const conditionData = analysisData.results.alpha_peak[condition];
        if (conditionData && typeof conditionData === 'object') {
          alphaPeakPayload[condition] = {};
          for (const [ch, data] of Object.entries(conditionData)) {
            const peakFreq = (data as any)?.peak_frequency;
            if (typeof peakFreq === 'number' && peakFreq > 0) {
              alphaPeakPayload[condition]![ch] = peakFreq;
            }
          }
        }
      }
      if (Object.keys(alphaPeakPayload).length > 0) {
        payload.alpha_peak = alphaPeakPayload;
      }
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
      ...analysisData.results,
      ai_interpretation: interpretation,
    };

    await db
      .from('analyses')
      .update({ results: updatedResults })
      .eq('id', analysisId)
      .execute();

    return NextResponse.json({ interpretation });
  } catch (error: any) {
    console.error('Error generating AI interpretation:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI interpretation' },
      { status: 500 }
    );
  }
}
