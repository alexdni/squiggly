// Supabase Edge Function for EEG Analysis
// This calls a Python worker that you'll deploy separately

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { analysis_id } = await req.json()

    if (!analysis_id) {
      return new Response(
        JSON.stringify({ error: 'analysis_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch analysis and recording details
    const { data: analysis, error: fetchError } = await supabase
      .from('analyses')
      .select(`
        *,
        recording:recordings (
          id,
          file_path,
          eo_start,
          eo_end,
          ec_start,
          ec_end
        )
      `)
      .eq('id', analysis_id)
      .single()

    if (fetchError || !analysis) {
      return new Response(
        JSON.stringify({ error: 'Analysis not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update status to processing
    await supabase
      .from('analyses')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', analysis_id)

    // Call Python worker (deployed to external service)
    const pythonWorkerUrl = Deno.env.get('PYTHON_WORKER_URL')

    if (!pythonWorkerUrl) {
      throw new Error('PYTHON_WORKER_URL not configured')
    }

    // Submit job to Python worker
    const workerResponse = await fetch(`${pythonWorkerUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('WORKER_AUTH_TOKEN') || ''}`,
      },
      body: JSON.stringify({
        analysis_id: analysis_id,
        file_path: analysis.recording.file_path,
        eo_start: analysis.recording.eo_start,
        eo_end: analysis.recording.eo_end,
        ec_start: analysis.recording.ec_start,
        ec_end: analysis.recording.ec_end,
        supabase_url: Deno.env.get('SUPABASE_URL'),
        supabase_key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      }),
    })

    if (!workerResponse.ok) {
      throw new Error(`Worker returned ${workerResponse.status}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Analysis job submitted',
        analysis_id: analysis_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
