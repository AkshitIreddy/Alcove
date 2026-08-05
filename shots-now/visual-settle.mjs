export function beginSettle(signature, at) {
  return { previous: signature, unchangedSince: at, unchangedShots: 0 };
}

export function observeSettle(state, signature, at, stillMs) {
  if (signature !== state.previous) {
    return {
      state: { previous: signature, unchangedSince: at, unchangedShots: 0 },
      settled: false,
    };
  }

  const unchangedShots = state.unchangedShots + 1;
  return {
    state: { ...state, previous: signature, unchangedShots },
    settled: unchangedShots >= 3 && at - state.unchangedSince >= stillMs,
  };
}
