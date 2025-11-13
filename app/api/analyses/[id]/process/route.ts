import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { submitAnalysisJob, getWorkerConfig } from '@/lib/worker-client';

/**
 * Start EEG analysis processing
 *
 * Supports two modes:
 * 1. Mock mode (development): Generates fake results immediately
 * 2. Worker mode (production): Submits job to Python worker service
 *
 * Set WORKER_MODE=http and WORKER_SERVICE_URL in .env to use real workers
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

    // Fetch analysis and recording data
    const { data: analysis, error: fetchError } = await (supabase as any)
      .from('analyses')
      .select(`
        *,
        recording:recordings (
          id,
          filename,
          file_path,
          duration_seconds,
          sampling_rate,
          n_channels,
          eo_start,
          eo_end,
          ec_start,
          ec_end
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

    // Validate required recording data
    const recording = analysis.recording;
    if (!recording || !recording.file_path) {
      return NextResponse.json(
        { error: 'Recording file path not found' },
        { status: 400 }
      );
    }

    if (
      recording.eo_start === null || recording.eo_end === null ||
      recording.ec_start === null || recording.ec_end === null
    ) {
      return NextResponse.json(
        { error: 'Recording segments not labeled (EO/EC times missing)' },
        { status: 400 }
      );
    }

    // Update status to processing
    await (supabase as any)
      .from('analyses')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    const workerConfig = getWorkerConfig();

    // Check if we're in mock mode or real worker mode
    if (workerConfig.mode === 'mock') {
      // MOCK MODE: Generate fake results for development
      console.log('[Development] Running in MOCK mode - generating fake results');

      // Simulate processing time
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Generate mock analysis results
      const mockResults = generateMockResults(analysis.recording);

      // Update analysis with results
      await (supabase as any)
        .from('analyses')
        .update({
          status: 'completed',
          results: mockResults,
          completed_at: new Date().toISOString(),
        })
        .eq('id', params.id);

      return NextResponse.json({
        success: true,
        message: 'Analysis completed successfully (mock mode)',
        analysis_id: params.id,
        mode: 'mock',
      });
    } else {
      // REAL WORKER MODE: Submit job to Python worker
      console.log(`[Production] Submitting to ${workerConfig.mode} worker`);

      try {
        const result = await submitAnalysisJob(
          {
            analysisId: params.id,
            filePath: recording.file_path,
            eoStart: recording.eo_start,
            eoEnd: recording.eo_end,
            ecStart: recording.ec_start,
            ecEnd: recording.ec_end,
          },
          workerConfig
        );

        return NextResponse.json({
          success: true,
          message: result.message,
          analysis_id: params.id,
          mode: workerConfig.mode,
        });
      } catch (workerError: any) {
        console.error('Worker submission failed:', workerError);

        // Mark as failed
        await (supabase as any)
          .from('analyses')
          .update({
            status: 'failed',
            error_log: `Worker submission failed: ${workerError.message}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', params.id);

        return NextResponse.json(
          { error: 'Failed to submit job to worker', details: workerError.message },
          { status: 500 }
        );
      }
    }
  } catch (error: any) {
    console.error('Error processing analysis:', error);

    // Update status to failed
    const supabase = await createClient();
    await (supabase as any)
      .from('analyses')
      .update({
        status: 'failed',
        error_log: error.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    return NextResponse.json(
      { error: 'Failed to process analysis' },
      { status: 500 }
    );
  }
}

function generateMockResults(recording: any) {
  // Generate realistic mock data based on recording properties
  const channels = [
    'Fp1',
    'Fp2',
    'F7',
    'F3',
    'Fz',
    'F4',
    'F8',
    'T7',
    'C3',
    'Cz',
    'C4',
    'T8',
    'P7',
    'P3',
    'Pz',
    'P4',
    'P8',
    'O1',
    'O2',
  ];

  const bands = [
    'delta',
    'theta',
    'alpha1',
    'alpha2',
    'smr',
    'beta2',
    'hibeta',
    'lowgamma',
  ];

  // QC Report
  const qc_report = {
    artifact_rejection_rate: Math.random() * 20 + 5, // 5-25%
    bad_channels: [], // No bad channels for mock data
    ica_components_removed: Math.floor(Math.random() * 3 + 1), // 1-3 components
    final_epochs_eo: Math.floor((recording.eo_end - recording.eo_start) / 2), // Assume 2s epochs
    final_epochs_ec: Math.floor((recording.ec_end - recording.ec_start) / 2),
  };

  // Band Power Analysis
  const band_power: any = {
    eo: {},
    ec: {},
  };

  channels.forEach((channel) => {
    band_power.eo[channel] = {};
    band_power.ec[channel] = {};

    bands.forEach((band) => {
      // Generate realistic values with some variation
      const baseValue = Math.random() * 10 + 1;
      band_power.eo[channel][band] = {
        absolute: baseValue * (0.8 + Math.random() * 0.4),
        relative: Math.random() * 0.3,
      };
      band_power.ec[channel][band] = {
        absolute: baseValue * (0.8 + Math.random() * 0.4),
        relative: Math.random() * 0.3,
      };
    });
  });

  // Coherence Analysis
  const coherence_pairs = [
    { ch1: 'Fp1', ch2: 'Fp2', type: 'interhemispheric' },
    { ch1: 'F3', ch2: 'F4', type: 'interhemispheric' },
    { ch1: 'C3', ch2: 'C4', type: 'interhemispheric' },
    { ch1: 'P3', ch2: 'P4', type: 'interhemispheric' },
    { ch1: 'O1', ch2: 'O2', type: 'interhemispheric' },
    { ch1: 'F3', ch2: 'P3', type: 'long_range' },
    { ch1: 'F4', ch2: 'P4', type: 'long_range' },
  ];

  const coherence: any = {
    eo: [],
    ec: [],
  };

  coherence_pairs.forEach((pair) => {
    const eoValues: any = { ...pair };
    const ecValues: any = { ...pair };

    bands.forEach((band) => {
      eoValues[band] = Math.random() * 0.5 + 0.3; // 0.3-0.8
      ecValues[band] = Math.random() * 0.5 + 0.3;
    });

    coherence.eo.push(eoValues);
    coherence.ec.push(ecValues);
  });

  // Risk Pattern Detection (randomly assign some patterns)
  const risk_patterns = {
    adhd_like: Math.random() > 0.7,
    anxiety_like: Math.random() > 0.6,
    depression_like: Math.random() > 0.8,
    sleep_dysregulation: Math.random() > 0.75,
    hyper_arousal: Math.random() > 0.7,
  };

  // Band Ratios
  const band_ratios = {
    theta_beta_ratio: {
      frontal_avg: Math.random() * 2 + 1.5, // 1.5-3.5
      central_avg: Math.random() * 2 + 1.5,
    },
    alpha_theta_ratio: {
      occipital_avg: Math.random() * 1.5 + 0.5, // 0.5-2.0
      parietal_avg: Math.random() * 1.5 + 0.5,
    },
  };

  // Asymmetry Indices
  const asymmetry = {
    frontal_alpha: Math.random() * 0.4 - 0.2, // -0.2 to 0.2
    parietal_alpha: Math.random() * 0.3 - 0.15,
    frontal_theta: Math.random() * 0.3 - 0.15,
  };

  return {
    qc_report,
    band_power,
    coherence,
    risk_patterns,
    band_ratios,
    asymmetry,
    processing_metadata: {
      preprocessing_config: {
        resample_freq: 250,
        filter_low: 0.5,
        filter_high: 45,
        notch_freq: 60,
      },
      processing_time_seconds: 2,
      mne_version: 'mock-1.0.0',
    },
  };
}
