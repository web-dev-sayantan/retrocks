import { cleanup, render } from '@solidjs/testing-library';
import { SmilePlus, type IconNode } from 'lucide';
import { afterEach, describe, expect, it } from 'vitest';

import LucideIcon from './LucideIcon';

afterEach(cleanup);

const EVERY_KIND: IconNode = [
  ['path', { d: 'M12 12 L13 13' }],
  ['circle', { cx: 6, cy: 6, r: 3 }],
  ['rect', { width: 4, height: 4 }],
  ['line', { x1: 1, y1: 1, x2: 2, y2: 2 }],
  ['polyline', { points: '1,1 2,2' }],
  ['polygon', { points: '3,3 4,4' }],
  ['ellipse', { rx: 2, ry: 3 }],
];

describe('LucideIcon', () => {
  it('renders every Lucide SVG node kind with its attributes', () => {
    const { container } = render(() => <LucideIcon icon={EVERY_KIND} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    for (const tag of ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']) {
      expect(svg!.querySelectorAll(tag)).toHaveLength(1);
    }
    expect(svg!.querySelector('path')?.getAttribute('d')).toBe('M12 12 L13 13');
  });

  it('renders SVG tags outside the known set instead of dropping them', () => {
    const { container } = render(() => <LucideIcon icon={[['arc', { d: 'M1 1' }]]} />);
    const svg = container.querySelector('svg');
    expect(svg!.innerHTML).toContain('<arc');
    expect(svg!.querySelector('arc')?.getAttribute('d')).toBe('M1 1');
  });

  it('renders a real Lucide icon node without dropping shapes', () => {
    const { container } = render(() => <LucideIcon icon={SmilePlus} />);
    const svg = container.querySelector('svg');
    expect(svg!.children).toHaveLength(SmilePlus.length);
    expect(svg!.querySelectorAll('path').length).toBeGreaterThan(0);
  });
});
