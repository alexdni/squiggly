'use client';

import { useState } from 'react';
import { EO_LABELS, EC_LABELS } from '@/lib/constants';

interface EOECLabels {
  eoLabel?: string;
  ecLabel?: string;
  eoStart?: number;
  eoEnd?: number;
  ecStart?: number;
  ecEnd?: number;
  useManual: boolean;
}

interface EOECLabelingFormProps {
  onLabelsChange: (labels: EOECLabels) => void;
  recordingDuration?: number;
}

export default function EOECLabelingForm({
  onLabelsChange,
  recordingDuration,
}: EOECLabelingFormProps) {
  const [useManual, setUseManual] = useState(false);
  const [eoStart, setEoStart] = useState('');
  const [eoEnd, setEoEnd] = useState('');
  const [ecStart, setEcStart] = useState('');
  const [ecEnd, setEcEnd] = useState('');

  const handleToggle = (manual: boolean) => {
    setUseManual(manual);
    if (manual) {
      onLabelsChange({
        useManual: true,
        eoStart: eoStart ? parseFloat(eoStart) : undefined,
        eoEnd: eoEnd ? parseFloat(eoEnd) : undefined,
        ecStart: ecStart ? parseFloat(ecStart) : undefined,
        ecEnd: ecEnd ? parseFloat(ecEnd) : undefined,
      });
    } else {
      onLabelsChange({
        useManual: false,
      });
    }
  };

  const handleManualChange = () => {
    onLabelsChange({
      useManual: true,
      eoStart: eoStart ? parseFloat(eoStart) : undefined,
      eoEnd: eoEnd ? parseFloat(eoEnd) : undefined,
      ecStart: ecStart ? parseFloat(ecStart) : undefined,
      ecEnd: ecEnd ? parseFloat(ecEnd) : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-neuro-dark mb-2">
          EO/EC Segmentation
        </h3>
        <p className="text-sm text-gray-600">
          Specify which parts of the recording are Eyes-Open (EO) and Eyes-Closed (EC)
        </p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => handleToggle(false)}
          className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
            !useManual
              ? 'border-neuro-primary bg-neuro-primary text-white'
              : 'border-gray-300 text-gray-700 hover:border-neuro-primary'
          }`}
        >
          <div className="font-medium">Auto-detect from annotations</div>
          <div className="text-xs mt-1 opacity-90">
            Looks for EO/EC labels in EDF file
          </div>
        </button>

        <button
          onClick={() => handleToggle(true)}
          className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
            useManual
              ? 'border-neuro-primary bg-neuro-primary text-white'
              : 'border-gray-300 text-gray-700 hover:border-neuro-primary'
          }`}
        >
          <div className="font-medium">Manual time ranges</div>
          <div className="text-xs mt-1 opacity-90">
            Specify start/end times manually
          </div>
        </button>
      </div>

      {useManual && (
        <div className="bg-gray-50 rounded-lg p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Eyes-Open (EO) Segment
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Start (seconds)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={recordingDuration}
                  value={eoStart}
                  onChange={(e) => {
                    setEoStart(e.target.value);
                    handleManualChange();
                  }}
                  placeholder="0.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  End (seconds)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={recordingDuration}
                  value={eoEnd}
                  onChange={(e) => {
                    setEoEnd(e.target.value);
                    handleManualChange();
                  }}
                  placeholder={recordingDuration?.toString() || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Eyes-Closed (EC) Segment
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Start (seconds)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={recordingDuration}
                  value={ecStart}
                  onChange={(e) => {
                    setEcStart(e.target.value);
                    handleManualChange();
                  }}
                  placeholder="0.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  End (seconds)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={recordingDuration}
                  value={ecEnd}
                  onChange={(e) => {
                    setEcEnd(e.target.value);
                    handleManualChange();
                  }}
                  placeholder={recordingDuration?.toString() || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neuro-primary"
                />
              </div>
            </div>
          </div>

          {recordingDuration && (
            <div className="text-xs text-gray-500">
              Recording duration: {recordingDuration.toFixed(1)} seconds
            </div>
          )}
        </div>
      )}

      {!useManual && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">Auto-detection will look for:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>EO labels: {EO_LABELS.join(', ')}</li>
                <li>EC labels: {EC_LABELS.join(', ')}</li>
              </ul>
              <p className="mt-2 text-xs">
                If no annotations are found, you&apos;ll be prompted to enter time ranges manually.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
