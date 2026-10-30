'use client';

/** A row of mutually exclusive buttons, as a radio group. */
export default function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            value === v ? 'bg-neuro-primary text-white' : 'bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
