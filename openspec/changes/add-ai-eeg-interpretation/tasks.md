## 1. Environment & Dependencies

- [x] 1.1 Add `openai` npm package to dependencies
- [x] 1.2 Add `OPENAI_API_KEY` to `.env.example` with placeholder
- [x] 1.3 Create `lib/openai-client.ts` with typed OpenAI client wrapper

## 2. API Endpoint

- [x] 2.1 Create `app/api/analyses/[id]/ai-interpretation/route.ts`
- [x] 2.2 Implement POST handler with authentication check
- [x] 2.3 Implement data extraction from analysis results (band power, ratios, asymmetry, LZC)
- [x] 2.4 Build expert neurotech system prompt
- [x] 2.5 Build user prompt with structured EEG data payload
- [x] 2.6 Call OpenAI API with GPT-4 model
- [x] 2.7 Parse and structure GPT response into sections
- [x] 2.8 Store interpretation in `analyses.results.ai_interpretation`
- [x] 2.9 Return interpretation to client
- [x] 2.10 Implement GET handler to retrieve cached interpretation

## 3. Frontend Integration

- [x] 3.1 Add "AI Analysis" button to `AnalysisDetailsClient.tsx` (visible when status=completed)
- [x] 3.2 Add loading state while AI interpretation is being generated
- [x] 3.3 Add AI Interpretation display section with structured subsections
- [x] 3.4 Add prominent disclaimer banner in AI interpretation section
- [x] 3.5 Add "Regenerate" button to request fresh interpretation
- [x] 3.6 Style AI interpretation section with distinct visual treatment

## 4. Prompt Engineering

- [x] 4.1 Create `lib/prompts/eeg-interpretation.ts` with system and user prompt templates
- [x] 4.2 Test prompt with sample EEG data for quality of interpretation
- [x] 4.3 Refine prompt based on output quality (iterate 2-3 times)
- [x] 4.4 Add client metadata (age, gender, diagnosis) to prompt if available

## 5. Error Handling & Edge Cases

- [x] 5.1 Handle OpenAI API errors gracefully (rate limits, timeouts, auth errors)
- [x] 5.2 Handle missing/incomplete analysis data
- [x] 5.3 Add timeout handling (60s max)
- [x] 5.4 Display user-friendly error messages

## 6. Testing

- [ ] 6.1 Write unit tests for data extraction logic
- [ ] 6.2 Write integration tests for API endpoint (mock OpenAI)
- [x] 6.3 Manual E2E test with real API key
