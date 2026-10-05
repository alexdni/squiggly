'use client';

import type { ReactNode } from 'react';
import { hasLegacyVisual, type AnalysisResults } from '@/lib/analysis-results';

type Results = Partial<AnalysisResults> | null | undefined;

export interface LegacyPanel {
  key: string;
  /** Heading above the image, e.g. 'Eyes Open' */
  title: string;
  alt: string;
}

export interface LegacyOrLiveProps {
  results: Results;
  /**
   * A single visual key (renders one image), or per-condition panels (renders a card per stored
   * image, matching the former analysis-page markup).
   */
  visual: { key: string; alt: string } | LegacyPanel[];
  /** Layout for panel cards: side by side with centred titles, or stacked. */
  layout?: 'pair' | 'stack';
  children: ReactNode;
}

/** True when any of the given keys holds a Python-era PNG URL. */
export function hasAnyLegacyVisual(results: Results, keys: string[]): boolean {
  return keys.some((k) => hasLegacyVisual(results, k));
}

/** Shows the stored PNG(s) for Python-era analyses, otherwise the live-rendered children. */
export default function LegacyOrLive({ results, visual, layout = 'stack', children }: LegacyOrLiveProps) {
  if (!Array.isArray(visual)) {
    if (!hasLegacyVisual(results, visual.key)) return <>{children}</>;
    return (
      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={results!.visuals![visual.key]} alt={visual.alt} className="w-full h-auto" />
      </div>
    );
  }

  const panels = visual.filter((p) => hasLegacyVisual(results, p.key));
  if (panels.length === 0) return <>{children}</>;
  return (
    <div className={layout === 'pair' ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : 'grid grid-cols-1 gap-6'}>
      {panels.map((p) => (
        <div key={p.key} className="border border-gray-200 rounded-lg p-4">
          <h3 className={`text-lg font-semibold text-gray-900 mb-3 ${layout === 'pair' ? 'text-center' : ''}`}>
            {p.title}
          </h3>
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={results!.visuals![p.key]} alt={p.alt} className="w-full h-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}
