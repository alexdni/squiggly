import { useMemo } from 'react';
import { applyEEGFilters } from '@/lib/eeg-filters';
import type { UnifiedSignalData, FilterSettings } from './types';

interface FilteredOutput {
  filteredSignals: number[][];
  timeLabels: number[];
}

export function useEEGFilters(
  signalData: UnifiedSignalData | null,
  selectedChannels: number[],
  timeStart: number,
  filterSettings: FilterSettings
): FilteredOutput {
  return useMemo(() => {
    if (!signalData || selectedChannels.length === 0) {
      return { filteredSignals: [], timeLabels: [] };
    }

    const { signals, sampleRate } = signalData;
    const { windowDurationSeconds, highpassHz, lowpassHz, notchHz } = filterSettings;

    // 1. Over-fetch with 1s padding on each side to avoid filter edge transients
    const padSeconds = 1;
    const padSamples = Math.floor(padSeconds * sampleRate);

    const visibleStartSample = Math.floor(timeStart * sampleRate);
    const visibleEndSample = Math.floor((timeStart + windowDurationSeconds) * sampleRate);

    const fetchStart = Math.max(0, visibleStartSample - padSamples);
    const fetchEnd = Math.min(signals[0]?.length ?? 0, visibleEndSample + padSamples);

    // Offset within the padded slice where the visible window begins/ends
    const trimStart = visibleStartSample - fetchStart;
    const trimEnd = trimStart + (visibleEndSample - visibleStartSample);

    const paddedSignals = selectedChannels.map((chIdx) => {
      const channelData = signals[chIdx];
      if (!channelData) return [];
      return channelData.slice(fetchStart, fetchEnd);
    });

    // 2. Apply filters to the padded (larger) segment, then trim to visible window
    const filtered = paddedSignals.map((sig) => {
      if (sig.length < 10) return sig;
      const filteredFull = applyEEGFilters(sig, sampleRate, {
        highpassHz,
        lowpassHz,
        notchHz,
      });
      return filteredFull.slice(trimStart, trimEnd);
    });

    // 3. Downsample to ~2000 points
    const targetPoints = 2000;
    const downsampled = filtered.map((channelData) => {
      if (channelData.length <= targetPoints) return channelData;
      const result: number[] = [];
      const step = channelData.length / targetPoints;
      for (let i = 0; i < targetPoints; i++) {
        result.push(channelData[Math.floor(i * step)]);
      }
      return result;
    });

    // 4. Generate time labels
    const numPoints = downsampled[0]?.length || 0;
    const timeLabels: number[] = [];
    for (let i = 0; i < numPoints; i++) {
      timeLabels.push(timeStart + (i / numPoints) * windowDurationSeconds);
    }

    return { filteredSignals: downsampled, timeLabels };
  }, [signalData, selectedChannels, timeStart, filterSettings]);
}
