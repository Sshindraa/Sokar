import { describe, expect, it } from 'vitest';
import { buildWidgetPreviewUrl } from './widget-preview-url';

describe('buildWidgetPreviewUrl', () => {
  it('targets the canonical dashboard widget on the current origin', () => {
    expect(buildWidgetPreviewUrl('chez-sokar-demo', '#0f172a', '#f97316')).toBe(
      '/widget/chez-sokar-demo?embedded=1&primary=0f172a&accent=f97316',
    );
  });

  it('encodes the slug and custom colors safely', () => {
    expect(buildWidgetPreviewUrl('chez sokar', '#112233', '#aabbcc')).toBe(
      '/widget/chez%20sokar?embedded=1&primary=112233&accent=aabbcc',
    );
  });
});
