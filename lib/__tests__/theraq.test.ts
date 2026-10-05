import { describe, it, expect } from 'vitest';
import {
  detectTheraqPhase,
  THERAQ_PHASES,
  THERAQ_PHASE_TO_CONDITION,
} from '../theraq';

describe('TheraQ phase detection', () => {
  it('maps the standard four test filenames to the right phases', () => {
    // Order matters: "eyes_open_under_load" and "eyes_open_2" both contain "open"
    expect(detectTheraqPhase('eyes_open.edf')).toBe('EO1');
    expect(detectTheraqPhase('eyes_closed.edf')).toBe('EC');
    expect(detectTheraqPhase('eyes_open_2.edf')).toBe('EO2');
    expect(detectTheraqPhase('eyes_open_under_load.edf')).toBe('TASK');
  });

  it('recognizes common alternate tokens', () => {
    expect(detectTheraqPhase('subject_TASK.edf')).toBe('TASK');
    expect(detectTheraqPhase('rec_cognitive_load.bdf')).toBe('TASK');
    expect(detectTheraqPhase('baseline_EO.csv')).toBe('EO1');
    expect(detectTheraqPhase('retest.edf')).toBe('EO2');
    expect(detectTheraqPhase('closed_eyes.edf')).toBe('EC');
  });

  it('returns null when no phase token is present', () => {
    expect(detectTheraqPhase('random_recording.edf')).toBeNull();
  });

  it('maps every phase to a distinct condition key', () => {
    const conditions = THERAQ_PHASES.map((p) => THERAQ_PHASE_TO_CONDITION[p]);
    expect(new Set(conditions).size).toBe(THERAQ_PHASES.length);
    expect(conditions).toEqual(['eo1', 'ec', 'eo2', 'eoload']);
  });
});
