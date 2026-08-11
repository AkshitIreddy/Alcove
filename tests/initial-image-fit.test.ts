import { describe, expect, it } from 'vitest';
import {
  initialImageWidthForPage,
  safeStandaloneUploadWidth,
} from '../src/editor/media/initialImageFit';

describe('new image page-fit safety', () => {
  it('reduces only display width enough to preserve following page content', () => {
    expect(
      initialImageWidthForPage({
        currentWidthPct: 100,
        imageHeightPx: 600,
        blockHeightPx: 632,
        blockTopPx: 160,
        followingContentHeightPx: 220,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(47);
  });

  it('leaves an upload alone when the page already has room', () => {
    expect(
      initialImageWidthForPage({
        currentWidthPct: 76,
        imageHeightPx: 240,
        blockHeightPx: 260,
        blockTopPx: 120,
        followingContentHeightPx: 180,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(76);
  });

  it('never enlarges or crushes the page copy below the manual resize floor', () => {
    expect(
      initialImageWidthForPage({
        currentWidthPct: 68,
        imageHeightPx: 900,
        blockHeightPx: 930,
        blockTopPx: 610,
        followingContentHeightPx: 90,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(10);
  });

  it('gives a direct tall upload a conservative first display without resampling it', () => {
    expect(
      safeStandaloneUploadWidth({
        intrinsicWidth: 1024,
        intrinsicHeight: 1536,
        pageWidthPx: 520,
        pageCapacityPx: 720,
      }),
    ).toBe(41);
    expect(
      safeStandaloneUploadWidth({
        intrinsicWidth: 1600,
        intrinsicHeight: 600,
        pageWidthPx: 520,
        pageCapacityPx: 720,
      }),
    ).toBe(100);
  });
});
