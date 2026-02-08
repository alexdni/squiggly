'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FilterSettings } from './types';

interface EEGToolbarProps {
  filterSettings: FilterSettings;
  onFilterChange: (settings: FilterSettings) => void;
  isAnnotateMode: boolean;
  onAnnotateModeToggle: () => void;
}

export default function EEGToolbar({
  filterSettings,
  onFilterChange,
  isAnnotateMode,
  onAnnotateModeToggle,
}: EEGToolbarProps) {
  // Local state for debounced numeric inputs
  const [localSensitivity, setLocalSensitivity] = useState(
    String(filterSettings.sensitivityMicrovolts)
  );
  const [localHP, setLocalHP] = useState(String(filterSettings.highpassHz));
  const [localLP, setLocalLP] = useState(String(filterSettings.lowpassHz));

  // Sync local state when filterSettings change externally
  useEffect(() => {
    setLocalSensitivity(String(filterSettings.sensitivityMicrovolts));
    setLocalHP(String(filterSettings.highpassHz));
    setLocalLP(String(filterSettings.lowpassHz));
  }, [filterSettings.sensitivityMicrovolts, filterSettings.highpassHz, filterSettings.lowpassHz]);

  // Debounced apply for numeric fields
  const applyDebounced = useCallback(
    (field: keyof FilterSettings, value: string) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) return;
      onFilterChange({ ...filterSettings, [field]: num });
    },
    [filterSettings, onFilterChange]
  );

  // Debounce timers
  useEffect(() => {
    const timer = setTimeout(() => {
      applyDebounced('sensitivityMicrovolts', localSensitivity);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSensitivity]);

  useEffect(() => {
    const timer = setTimeout(() => {
      applyDebounced('highpassHz', localHP);
    }, 300);
    return () => clearTimeout(timer);
  }, [localHP]);

  useEffect(() => {
    const timer = setTimeout(() => {
      applyDebounced('lowpassHz', localLP);
    }, 300);
    return () => clearTimeout(timer);
  }, [localLP]);

  return (
    <div className="flex items-center gap-3 flex-wrap bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
      {/* Sensitivity */}
      <div className="flex items-center gap-1">
        <label className="text-xs font-semibold text-gray-700">Sens:</label>
        <input
          type="number"
          min={10}
          max={500}
          step={10}
          value={localSensitivity}
          onChange={(e) => setLocalSensitivity(e.target.value)}
          className="border border-gray-300 rounded px-1.5 py-0.5 w-16 text-sm text-gray-900 bg-white"
        />
        <span className="text-xs text-gray-600">uV</span>
      </div>

      {/* Window duration */}
      <div className="flex items-center gap-1">
        <label className="text-xs font-semibold text-gray-700">Window:</label>
        <select
          value={filterSettings.windowDurationSeconds}
          onChange={(e) =>
            onFilterChange({
              ...filterSettings,
              windowDurationSeconds: Number(e.target.value),
            })
          }
          className="border border-gray-300 rounded px-1.5 py-0.5 text-sm text-gray-900 bg-white"
        >
          <option value={5}>5s</option>
          <option value={10}>10s</option>
          <option value={15}>15s</option>
          <option value={30}>30s</option>
        </select>
      </div>

      <div className="w-px h-5 bg-gray-300" />

      {/* HP Filter */}
      <div className="flex items-center gap-1">
        <label className="text-xs font-semibold text-gray-700">HP:</label>
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={localHP}
          onChange={(e) => setLocalHP(e.target.value)}
          className="border border-gray-300 rounded px-1.5 py-0.5 w-14 text-sm text-gray-900 bg-white"
        />
        <span className="text-xs text-gray-600">Hz</span>
      </div>

      {/* LP Filter */}
      <div className="flex items-center gap-1">
        <label className="text-xs font-semibold text-gray-700">LP:</label>
        <input
          type="number"
          min={1}
          max={200}
          step={1}
          value={localLP}
          onChange={(e) => setLocalLP(e.target.value)}
          className="border border-gray-300 rounded px-1.5 py-0.5 w-14 text-sm text-gray-900 bg-white"
        />
        <span className="text-xs text-gray-600">Hz</span>
      </div>

      {/* Notch */}
      <div className="flex items-center gap-1">
        <label className="text-xs font-semibold text-gray-700">Notch:</label>
        <select
          value={filterSettings.notchHz}
          onChange={(e) =>
            onFilterChange({
              ...filterSettings,
              notchHz: Number(e.target.value),
            })
          }
          className="border border-gray-300 rounded px-1.5 py-0.5 text-sm text-gray-900 bg-white"
        >
          <option value={0}>Off</option>
          <option value={50}>50 Hz</option>
          <option value={60}>60 Hz</option>
        </select>
      </div>

      <div className="w-px h-5 bg-gray-300" />

      {/* Annotate toggle */}
      <button
        onClick={onAnnotateModeToggle}
        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
          isAnnotateMode
            ? 'bg-yellow-500 text-white'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        Annotate
      </button>
    </div>
  );
}
