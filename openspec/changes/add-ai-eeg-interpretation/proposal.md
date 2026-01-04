# Change: Add AI-Powered EEG Interpretation

## Why

Users need expert-level interpretation of their EEG analysis results to understand biomarkers and clinical patterns. Currently, the platform displays raw metrics and heuristic risk flags, but lacks contextual interpretation that would help users understand what their data means from a neurotech/clinical perspective. By integrating with GPT-4, we can provide professional-grade narrative assessments of EEG patterns, biomarkers, and recommendations—while maintaining clear disclaimers about educational/non-diagnostic use.

## What Changes

- Add new "AI Analysis" button to the completed analysis view
- Create new API endpoint `POST /api/analyses/[id]/ai-interpretation` that:
  - Extracts all quantitative analysis data (band power, ratios, asymmetry, coherence, LZC, risk patterns)
  - Constructs a structured prompt for GPT-4 with expert neurotech framing
  - Returns narrative interpretation covering biomarkers, patterns, and educational observations
- Store AI interpretation results in the `analyses.results` JSONB column under a new `ai_interpretation` key
- Display AI interpretation in a dedicated section with appropriate disclaimers
- Support caching/retrieval of previously generated interpretations

## Impact

- Affected specs: New capability `ai-interpretation`
- Affected code:
  - `app/api/analyses/[id]/ai-interpretation/route.ts` (new)
  - `components/AnalysisDetailsClient.tsx` (add button + display section)
  - `lib/openai-client.ts` (new)
  - Environment variables: `OPENAI_API_KEY`
