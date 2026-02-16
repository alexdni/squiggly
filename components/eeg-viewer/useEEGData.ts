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

export function useEEGData(recordingId: string, filePath: string) {
  const [signalData, setSignalData] = useState<UnifiedSignalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const fileExtension = filePath.toLowerCase().split('.').pop();

      // Download the file via API
      const signedUrlResponse = await fetch(
        `/api/recordings/${recordingId || 'unknown'}/download?path=${encodeURIComponent(filePath)}`
      );

      let data: Blob;
      if (signedUrlResponse.ok) {
        const { signedUrl } = await signedUrlResponse.json();
        const downloadResponse = await fetch(signedUrl);
        if (!downloadResponse.ok) throw new Error('Failed to download file');
        data = await downloadResponse.blob();
      } else {
        const token = btoa(
          JSON.stringify({
            bucket: 'recordings',
            path: filePath,
            expires: Date.now() + 60000,
          })
        );
        const downloadResponse = await fetch(`/api/storage/download?token=${token}`);
        if (!downloadResponse.ok) throw new Error('Failed to download file');
        data = await downloadResponse.blob();
      }

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
  }, [recordingId, filePath]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  return { signalData, isLoading, error };
}
