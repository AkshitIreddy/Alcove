import { describe, expect, it } from 'vitest';
import {
  fitImageWidthToRemainingPage,
  initialImageWidthForPage,
  safeManualImageResizeWidth,
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

  it('lets pagination move following copy while keeping the image leaf-safe', () => {
    expect(
      safeManualImageResizeWidth({
        measuredWidthPct: 40,
        requestedWidthPct: 90,
        imageHeightPx: 240,
        blockHeightPx: 270,
        blockTopPx: 120,
        followingContentHeightPx: 160,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(90);
  });

  it('stops a tall image inside the space remaining on its current leaf', () => {
    expect(
      safeManualImageResizeWidth({
        measuredWidthPct: 70,
        requestedWidthPct: 130,
        imageHeightPx: 600,
        blockHeightPx: 630,
        blockTopPx: 300,
        followingContentHeightPx: 300,
        pageCapacityPx: 820,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(54);
  });

  it('allows manual enlargement when the page has room', () => {
    expect(
      safeManualImageResizeWidth({
        measuredWidthPct: 40,
        requestedWidthPct: 75,
        imageHeightPx: 100,
        blockHeightPx: 120,
        blockTopPx: 80,
        followingContentHeightPx: 60,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(75);
  });

  it('fits an image into only the unused space between its neighbours', () => {
    expect(
      fitImageWidthToRemainingPage({
        measuredWidthPct: 40,
        maximumWidthPct: 132,
        imageHeightPx: 200,
        blockHeightPx: 230,
        blockTopPx: 100,
        followingContentHeightPx: 150,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(83);
  });

  it('uses the rest of an otherwise empty leaf without exceeding the leaf width', () => {
    expect(
      fitImageWidthToRemainingPage({
        measuredWidthPct: 40,
        maximumWidthPct: 132,
        imageHeightPx: 200,
        blockHeightPx: 230,
        blockTopPx: 100,
        followingContentHeightPx: 0,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(113);
  });

  it('never shrinks an image when the remaining space is already exhausted', () => {
    expect(
      fitImageWidthToRemainingPage({
        measuredWidthPct: 70,
        maximumWidthPct: 132,
        imageHeightPx: 500,
        blockHeightPx: 530,
        blockTopPx: 300,
        followingContentHeightPx: 100,
        pageCapacityPx: 720,
        pagePaddingBottomPx: 24,
        minimumWidthPct: 10,
      }),
    ).toBe(70);
  });
});
