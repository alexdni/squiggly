'use client';

import { useEffect, useRef, useState } from 'react';
import { dampValues } from './timelapse';

// Damps the displayed voxel values toward each new target instead of cutting to
// it. Averaging frames removes the estimate's variance; this removes the step.
//
// All the arithmetic lives in dampValues — what is here is React and rAF
// plumbing, which the node test environment cannot exercise.

/** Past five time constants the remaining motion is under 1% and invisible, so
 *  the loop stops rather than burning a frame callback forever. */
const SETTLE_TIME_CONSTANTS = 5;

/**
 * Values to render: the latest `target`, continuously approached with time
 * constant `tauMs`.
 *
 * Exponential decay rather than an ease over a fixed window: an ease reaches
 * its target and stops, so velocity jumps when the next target arrives and the
 * image kinks once per second. Decay has no boundary — a target replaced
 * mid-flight just redirects the motion already underway.
 *
 * Drives on requestAnimationFrame, so it pauses with a hidden tab; on return
 * the elapsed dt is large, which lands it on the target rather than replaying
 * the animation.
 *
 * A null target clears immediately. That only happens when no frame in the span
 * was usable, and the caller already hides the views then.
 */
export function useSmoothedValues(
  target: Float32Array | null,
  tauMs: number
): Float32Array | null {
  const [displayed, setDisplayed] = useState<Float32Array | null>(null);

  /** Mirrors `displayed` so the loop can read it without re-subscribing. */
  const displayedRef = useRef<Float32Array | null>(null);
  /** Two buffers, alternated: React needs a new reference to re-render, and
   *  mutating the buffer currently on screen would tear it. Damping reads one
   *  and writes the other, so they never alias. */
  const buffersRef = useRef<Float32Array[]>([]);
  const activeRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const commit = (values: Float32Array | null) => {
      displayedRef.current = values;
      setDisplayed(values);
    };

    if (!target) {
      commit(null);
      return undefined;
    }

    if (buffersRef.current[0]?.length !== target.length) {
      buffersRef.current = [new Float32Array(target.length), new Float32Array(target.length)];
      displayedRef.current = null;
    }

    const nextBuffer = () => {
      activeRef.current ^= 1;
      return buffersRef.current[activeRef.current];
    };

    const current = displayedRef.current;
    if (!current || tauMs <= 0) {
      // Nothing on screen to move from — the first frame, or playback
      // resuming after every window in the span was rejected.
      const buffer = nextBuffer();
      buffer.set(target);
      commit(buffer);
      return undefined;
    }

    const startedAt = performance.now();
    let previous = startedAt;

    const step = () => {
      const now = performance.now();
      const dt = now - previous;
      previous = now;

      commit(dampValues(displayedRef.current!, target, dt, tauMs, nextBuffer()));

      if (now - startedAt < tauMs * SETTLE_TIME_CONSTANTS) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frameRef.current);
  }, [target, tauMs]);

  return displayed;
}
