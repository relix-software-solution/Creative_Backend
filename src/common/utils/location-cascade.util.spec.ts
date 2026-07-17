import { collectZoneSubtree } from './location-cascade.util';

describe('collectZoneSubtree', () => {
  it('returns recursive zone levels without including unrelated branches', () => {
    const zones = [
      { id: 'root', parentId: null },
      { id: 'child-a', parentId: 'root' },
      { id: 'child-b', parentId: 'root' },
      { id: 'grandchild', parentId: 'child-a' },
      { id: 'unrelated', parentId: null },
    ];

    expect(collectZoneSubtree(zones, ['root'])).toEqual([
      ['root'],
      ['child-a', 'child-b'],
      ['grandchild'],
    ]);
  });

  it('handles multiple roots without returning a zone twice', () => {
    const zones = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ];

    expect(collectZoneSubtree(zones, ['root', 'child'])).toEqual([
      ['root', 'child'],
    ]);
  });
});
