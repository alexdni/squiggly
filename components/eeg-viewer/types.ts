export interface EEGAnnotation {
  id: string;
  dbId?: string;
  startTime: number;
  endTime: number;
  description: string;
  type: 'artifact' | 'event' | 'note';
  color?: string;
}

export interface FilterSettings {
  sensitivityMicrovolts: number;
  windowDurationSeconds: number;
  lowpassHz: number;
  highpassHz: number;
  notchHz: number;
}

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  sensitivityMicrovolts: 70,
  windowDurationSeconds: 10,
  lowpassHz: 70,
  highpassHz: 0.5,
  notchHz: 60,
};

export interface UnifiedSignalData {
  signals: number[][];
  sampleRate: number;
  duration: number;
  channelNames: string[];
  fileType: 'edf' | 'csv';
}

export interface AnnotationDragState {
  isDragging: boolean;
  startX: number;
  endX: number;
  startTime: number;
  endTime: number;
}
