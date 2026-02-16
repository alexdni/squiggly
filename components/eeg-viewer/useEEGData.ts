import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-client';
import {
  parseEDFFile,
  type EDFData,
} from '@/lib/edf-reader-browser';
import {
  parseCSVFile,
  filterValidChannels,
  type CSVData,
} from '@/lib/csv-reader-browser';
import { EXCLUDED_CHANNEL_PATTERNS } from '@/lib/constants';
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

      // Download the file from Supabase storage
      const supabase = createClient();
      const { data, error: downloadError } = await supabase.storage
        .from('recordings')
        .download(filePath);

      if (downloadError) throw downloadError;

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
