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
        const arrayBuffer = await data.arrayBuffer();
        const parsedData = await parseEDFFile(arrayBuffer);

        setSignalData({
          signals: parsedData.signals,
          sampleRate: parsedData.sampleRate,
          duration: parsedData.duration,
          channelNames: parsedData.header.channels.map((ch) => ch.label),
          fileType: 'edf',
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
