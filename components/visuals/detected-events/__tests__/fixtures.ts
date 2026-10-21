import type { DetectedEventResult } from '@/lib/analysis-results';

let n = 0;
/** A detected event in the shape the analysis job stores (ids: 16 hex chars). */
export function ev(partial: Partial<DetectedEventResult> & Pick<DetectedEventResult, 'pattern'>): DetectedEventResult {
  n += 1;
  return {
    id: n.toString(16).padStart(16, '0'),
    category: 'artifact',
    startSec: 0,
    endSec: 1,
    channels: [],
    confidence: 1,
    evidence: {},
    handling: 'noted',
    source: 'pipeline-stage',
    ...partial,
  };
}
