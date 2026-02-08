'use client';

import { useState } from 'react';
import type { EEGAnnotation } from './types';

interface EEGAnnotationModalProps {
  startTime: number;
  endTime: number;
  onAdd: (description: string, type: EEGAnnotation['type']) => void;
  onCancel: () => void;
}

export default function EEGAnnotationModal({
  startTime,
  endTime,
  onAdd,
  onCancel,
}: EEGAnnotationModalProps) {
  const [description, setDescription] = useState('');
  const [type, setType] = useState<EEGAnnotation['type']>('artifact');

  const duration = endTime - startTime;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(description, type);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Add Annotation</h3>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Start Time</label>
                <div className="mt-1 px-3 py-2 bg-gray-100 rounded text-sm text-gray-900">
                  {startTime.toFixed(2)}s
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Duration</label>
                <div className="mt-1 px-3 py-2 bg-gray-100 rounded text-sm text-gray-900">
                  {duration.toFixed(2)}s
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as EEGAnnotation['type'])}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white"
              >
                <option value="artifact">Artifact</option>
                <option value="event">Event</option>
                <option value="note">Note</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Eye blink artifact"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white"
                autoFocus
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-neuro-primary rounded hover:bg-neuro-accent transition-colors"
            >
              Add Annotation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
