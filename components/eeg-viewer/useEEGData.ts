import { useState, useEffect, useCallback } from 'react';
import {
  parseEDFFile,
  type EDFData,
} from '@/lib/edf-reader-browser';
import {
  parseCSVFile,
  filterValidChannels,
  type CSVData,
} from '@/lib/csv-reader-browser';
import { ALL_EEG_CHANNELS, EXCLUDED_CHANNEL_PATTERNS } from '@/lib/constants';
import type { UnifiedSignalData } from './types';

export interface EEGDataSource {
  /** Fetch this URL directly (e.g. an analysis's cleaned file) instead of the recording. */
  url?: string | null;
  /** File type of `url`: 'edf' | 'bdf' | 'csv', with or without a leading dot. */
  format?: string | null;
  /** Load only when true (default true), so optional sources are fetched on demand. */
  enabled?: boolean;
}

export function useEEGData(recordingId: string, filePath: string, source: EEGDataSource = {}) {
  const [signalData, setSignalData] = useState<UnifiedSignalData | null>(null);
  const [isLoading, setIsLoading] = useState(source.enabled !== false);
  const [error, setError] = useState<string | null>(null);
  const { url: sourceUrl, format: sourceFormat, enabled = true } = source;

  const loadFile = useCallback(async () => {
    if (!enabled) return;
    try {
      setIsLoading(true);
      setError(null);

      const fileExtension = sourceUrl
        ? (sourceFormat || 'edf').replace(/^\./, '').toLowerCase()
        : filePath.toLowerCase().split('.').pop();

      let downloadUrl = sourceUrl;
      if (!downloadUrl) {
        // Short-lived signed URL for the recording (works with Supabase and local storage)
        const signedUrlResponse = await fetch(`/api/recordings/${recordingId}/download`);
        if (!signedUrlResponse.ok) {
          const body = await signedUrlResponse.json().catch(() => null);
          throw new Error(body?.error || 'Failed to get a download link for the recording');
        }
        downloadUrl = (await signedUrlResponse.json()).signedUrl as string;
      }
      const downloadResponse = await fetch(downloadUrl);
      if (!downloadResponse.ok) throw new Error('Failed to download file');
      const data = await downloadResponse.blob();

      if (fileExtension === 'csv') {
        const text = await data.text();
        const parsedData = await parseCSVFile(text);
        const filteredData = filterValidChannels(parsedData);

        setSignalData({
          signals: filteredData.signals,
          sampleRate: filteredData.sampleRate,
          duration: filteredData.duration,
          channelNames: filteredData.channelNames,
          fileType: 'csv',
        });
      } else {
        // EDF and BDF share the same reader (auto-detects format from header)
        const arrayBuffer = await data.arrayBuffer();
        const parsedData = await parseEDFFile(arrayBuffer);

        // Filter to only EEG channels (drop BioSemi aux, rail, impedance, etc.)
        const allLabels = parsedData.header.channels.map((ch) => ch.label);
        const eegIndices: number[] = [];
        const eegNames: string[] = [];
        for (let i = 0; i < allLabels.length; i++) {
          const label = allLabels[i];
          const isExcluded = EXCLUDED_CHANNEL_PATTERNS.some(p => p.test(label));
          if (!isExcluded) {
            eegIndices.push(i);
            eegNames.push(label);
          }
        }

        setSignalData({
          signals: eegIndices.map(i => parsedData.signals[i]),
          sampleRate: parsedData.sampleRate,
          duration: parsedData.duration,
          channelNames: eegNames,
          fileType: fileExtension === 'bdf' ? 'bdf' : 'edf',
        });
      }
    } catch (err: any) {
      console.error('Error loading file:', err);
      setError(err.message || 'Failed to load EEG data');
    } finally {
      setIsLoading(false);
    }
  }, [recordingId, filePath, sourceUrl, sourceFormat, enabled]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  return { signalData, isLoading, error };
}
