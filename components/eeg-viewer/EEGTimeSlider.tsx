'use client';

interface EEGTimeSliderProps {
  currentStart: number;
  windowDuration: number;
  totalDuration: number;
  onTimeChange: (newStart: number) => void;
}

export default function EEGTimeSlider({
  currentStart,
  windowDuration,
  totalDuration,
  onTimeChange,
}: EEGTimeSliderProps) {
  const maxStart = Math.max(0, totalDuration - windowDuration);

  const handlePrev = () => {
    onTimeChange(Math.max(0, currentStart - windowDuration));
  };

  const handleNext = () => {
    onTimeChange(Math.min(maxStart, currentStart + windowDuration));
  };

  const endTime = Math.min(currentStart + windowDuration, totalDuration);

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={handlePrev}
        disabled={currentStart <= 0}
        className="px-3 py-1 bg-neuro-primary text-white rounded text-sm disabled:opacity-50 hover:bg-neuro-accent transition-colors"
      >
        Prev
      </button>

      <input
        type="range"
        min={0}
        max={maxStart}
        step={0.1}
        value={currentStart}
        onChange={(e) => onTimeChange(parseFloat(e.target.value))}
        className="flex-1 accent-neuro-primary h-2"
      />

      <button
        onClick={handleNext}
        disabled={currentStart + windowDuration >= totalDuration}
        className="px-3 py-1 bg-neuro-primary text-white rounded text-sm disabled:opacity-50 hover:bg-neuro-accent transition-colors"
      >
        Next
      </button>

      <span className="text-xs text-gray-600 whitespace-nowrap min-w-[140px] text-right">
        {currentStart.toFixed(1)}s - {endTime.toFixed(1)}s / {totalDuration.toFixed(1)}s
      </span>
    </div>
  );
}
