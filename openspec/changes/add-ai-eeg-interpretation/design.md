## Context

The EEG analysis platform generates rich quantitative data including band power across 8 frequency bands, theta/beta and alpha/theta ratios, hemispheric asymmetry metrics, Lempel-Ziv complexity, inter-channel coherence, and heuristic risk pattern flags. Users need contextual interpretation of these metrics to understand their significance.

**Stakeholders:**
- End users seeking EEG interpretation (researchers, clinicians, neurofeedback practitioners)
- Platform maintainers (API cost management, prompt engineering)

**Constraints:**
- Must clearly disclaim non-diagnostic/educational nature
- API costs should be reasonable (~$0.01-0.05 per interpretation with GPT-4)
- Response time should be under 30 seconds
- Interpretation should be stored to avoid redundant API calls

## Goals / Non-Goals

**Goals:**
- Provide expert-quality narrative interpretation of EEG metrics
- Cover all major biomarker categories: amplitude patterns, ratios, asymmetry, complexity, connectivity
- Include educational context about what patterns may indicate
- Maintain clear disclaimers throughout

**Non-Goals:**
- Clinical diagnosis or treatment recommendations
- Real-time streaming responses (v1 uses simple request/response)
- Multi-model support (GPT-only in v1)
- User-customizable prompts (fixed expert prompt in v1)

## Decisions

### Decision: Use OpenAI GPT-4 API
- **What:** Integrate with OpenAI API using GPT-4 model
- **Why:** User has API key available, GPT-4 has strong medical/scientific knowledge, good structured output
- **Alternatives considered:**
  - Claude API: Comparable quality but user specified GPT
  - Local LLM: Would require GPU infrastructure, not suitable for serverless
  - GPT-3.5: Lower cost but less reliable for technical interpretation

### Decision: Expert Neurotech Persona Prompt
- **What:** System prompt frames GPT as an expert neurophysiologist/neurotech specialist
- **Why:** Produces more accurate, professional-grade interpretations
- **Prompt strategy:**
  - Role: Expert qEEG analyst with 20+ years experience
  - Task: Interpret quantitative EEG metrics
  - Output format: Structured narrative with sections
  - Constraints: Educational only, no diagnosis, cite research patterns

### Decision: Store Interpretation in `results.ai_interpretation`
- **What:** Extend existing `analyses.results` JSONB with new key
- **Why:** Keeps all analysis data together, enables caching, no schema migration needed
- **Structure:**
  ```json
  {
    "ai_interpretation": {
      "generated_at": "2024-01-15T10:30:00Z",
      "model": "gpt-4",
      "content": {
        "summary": "...",
        "amplitude_patterns": "...",
        "frequency_ratios": "...",
        "asymmetry_analysis": "...",
        "complexity_connectivity": "...",
        "observations": "...",
        "disclaimer": "..."
      }
    }
  }
  ```

### Decision: Button Trigger (Not Automatic)
- **What:** User clicks "AI Analysis" button to generate interpretation
- **Why:**
  - Avoids unnecessary API costs
  - User controls when they want AI interpretation
  - Some users may not want/need it
- **Alternative:** Auto-generate on analysis completion (rejected: cost concerns)

## Data Payload to LLM

The following data will be extracted and sent to GPT-4:

```typescript
interface EEGInterpretationPayload {
  recording_info: {
    duration_seconds: number;
    sampling_rate: number;
    n_channels: number;
    montage: string;
  };
  qc_report: {
    artifact_rejection_rate: number;
    bad_channels: string[];
    ica_components_removed: number;
    final_epochs_eo: number;
    final_epochs_ec: number;
  };
  band_power: {
    eo: Record<string, Record<string, number>>; // channel -> band -> power
    ec: Record<string, Record<string, number>>;
  };
  band_ratios: {
    theta_beta_ratio: { frontal_avg: number; central_avg: number };
    alpha_theta_ratio: { occipital_avg: number; parietal_avg: number };
  };
  asymmetry: {
    frontal_alpha: number;
    parietal_alpha: number;
    frontal_theta: number;
  };
  // Optional if available:
  lzc_values?: Record<string, number>;
  coherence_summary?: Record<string, number>;
  client_metadata?: {
    age?: number;
    gender?: string;
    primary_issue?: string;
  };
}
```

**Note:** Risk patterns are intentionally excluded from the payload as they are hardcoded heuristics. We let GPT-4 derive its own clinical observations from the raw metrics for more nuanced interpretation.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| API costs exceed budget | Cache interpretations, user-triggered only |
| Hallucinated medical claims | Strong prompt constraints, prominent disclaimers |
| Slow response time | Show loading state, set 60s timeout |
| API rate limits | Implement retry with backoff |
| Prompt injection via data | Sanitize numeric data only, no user text in prompt |

## Migration Plan

1. Add `OPENAI_API_KEY` to environment variables
2. Deploy API endpoint (no breaking changes)
3. Update frontend with new button/section
4. No database migration needed (uses existing JSONB column)

**Rollback:** Remove button from UI, endpoint remains but unused

## Open Questions

1. ~~Should we support regeneration of AI interpretation?~~ **Yes** - add "Regenerate" button that overwrites previous
2. ~~Token limit for response?~~ **Decided:** Max 2000 tokens output, ~1500 words
3. ~~Include client metadata (age, gender, diagnosis) if available?~~ **Yes** - enhances interpretation relevance
