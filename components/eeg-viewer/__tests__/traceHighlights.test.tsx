import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Capture the datasets the chart would draw.
const drawn: { data: { datasets: { label: string; data: { x: number; y: number }[]; borderColor: string; order: number }[] } }[] = [];
vi.mock('react-chartjs-2', () => ({
  Line: (props: (typeof drawn)[number]) => {
    drawn.push(props);
    return null;
  },
}));

const { default: EEGUnifiedChart } = await import('../EEGUnifiedChart');

const noop = () => {};

describe('EEGUnifiedChart trace highlights', () => {
  it('draws the highlighted stretch of that channel only, on top of it, out of the tooltip', () => {
    const times = Array.from({ length: 11 }, (_, i) => i * 0.1); // 0–1 s
    const flat = times.map(() => 0);
    drawn.length = 0;
    renderToStaticMarkup(
      <EEGUnifiedChart
        filteredSignals={[flat, times.map((t) => t)]}
        timeLabels={times}
        channelNames={['C3', 'C4']}
        selectedChannels={[0, 1]}
        sensitivityMicrovolts={50}
        annotations={[]}
        dragState={{ isDragging: false, startX: 0, currentX: 0, startTime: 0, currentTime: 0 } as never}
        isAnnotateMode={false}
        onDragStart={noop}
        onDragUpdate={noop}
        onDragEnd={noop}
        onDragCancel={noop}
        traceHighlights={[{ row: 1, startSec: 0.3, endSec: 0.5, color: 'teal' }]}
      />
    );
    const { datasets } = drawn.at(-1)!.data;
    expect(datasets).toHaveLength(3);
    const h = datasets[2];
    expect(h.label).toBe('C4 (highlight)');
    expect(h.borderColor).toBe('teal');
    expect(h.order).toBeLessThan(datasets[1].order);
    // C4's own values at 0.3–0.5 s, at C4's vertical offset (second row: −2 × sensitivity)
    expect(h.data.map((p) => Math.round(p.x * 10) / 10)).toEqual([0.3, 0.4, 0.5]);
    expect(h.data.map((p) => Math.round(p.y * 10) / 10)).toEqual([-99.7, -99.6, -99.5]);
  });
});
