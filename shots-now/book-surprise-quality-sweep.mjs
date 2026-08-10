/**
 * Production Surprise quality/diversity sweep plus a representative board.
 *
 * Runs the OBJECT-FORM generator used by Book Studio (not the compatibility
 * seed overload), sweeps 512 seeds in every direction, and renders six
 * distinct near-best results from each family through the shipped spine and
 * cover painters. The JSON report records the worst score and vocabulary
 * coverage, so a later curation change cannot quietly collapse variety.
 *
 * Usage: node shots-now/book-surprise-quality-sweep.mjs [--url=http://localhost:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const url = hit?.slice('--url='.length) || 'http://localhost:1420';
const outputDir = 'shots-now/out';
const boardPath = `${outputDir}/book-surprise-quality-search.png`;
const reportPath = `${outputDir}/book-surprise-quality-search.json`;
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1760 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.goto(`${url}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 400,
});

const report = await page.evaluate(async () => {
  const design = await import('/src/art/bookDesign.ts');
  const surprise = await import('/src/art/bookSurprise.ts');
  const style = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');
  const covers = await import('/src/art/covers.ts');
  const flat = await import('/src/art/flat.ts');

  await Promise.all([
    document.fonts.load('600 22px "Caveat Variable"'),
    document.fonts.load('400 13px "Nunito Sans"'),
  ].map((job) => job.catch(() => {})));
  await document.fonts.ready;

  const titlePool = [
    'Field Notes',
    'The Lantern Atlas',
    'Winter Herbarium',
    'Small Histories',
    'Maps of Rain',
    'Collected Letters',
  ];
  const allRows = [];
  const summaries = [];
  const failures = [];
  const hardDiagnosticCodes = new Set([
    'composition-hierarchy', 'duplicate-bands', 'material-structure', 'proportion',
  ]);
  const completeSignatureOf = (row) => {
    const item = row.recipe.style;
    return [
      row.preset.id, row.recipe.archetype, item.titlePlate, item.coverFrame,
      item.coverMedallion, item.ornament, item.raisedBands, item.charm,
      item.cornerProtectors ? 'corners' : 'clean',
      item.insetPlate ? 'inset' : 'flat',
      item.spineBaseHex, item.spineAccentHex, item.coverBaseHex, item.coverAccentHex,
    ].join('|');
  };

  for (let directionIndex = 0; directionIndex < design.BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
    const direction = design.BOOK_SURPRISE_DIRECTIONS[directionIndex];
    const rows = [];
    const presetIds = new Set();
    const shapes = new Set();
    const materials = new Set();
    const palettes = new Set();
    const archetypes = new Set();
    const plates = new Set();
    const frames = new Set();
    const ornaments = new Set();
    const compositions = new Set();
    const scores = [];
    const signatureCounts = new Map();
    const diagnosticHistogram = new Map();
    const qualityCounts = { excellent: 0, strong: 0, acceptable: 0 };
    let total = 0;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = 0;
    let lockedCompromises = 0;
    let duplicateBands = 0;
    let constraintViolations = 0;
    let hardDiagnostics = 0;
    let widenedSelections = 0;
    let evaluatedCandidates = 0;
    let minimumCandidates = Number.POSITIVE_INFINITY;
    let maximumCandidates = 0;
    let minimumSpineWidth = Number.POSITIVE_INFINITY;
    let minimumSpineRatio = Number.POSITIVE_INFINITY;
    let violatingSelections = 0;
    let maximumViolations = 0;
    let belowWidthFloor = 0;
    let belowRatioFloor = 0;
    let unsafeAutomaticEmblems = 0;
    let mismatchedEmblems = 0;
    let repeatedFields = 0;
    let stackedProgrammes = 0;
    let appliedFurniture = 0;
    let excessiveBands = 0;

    for (let seedIndex = 0; seedIndex < 512; seedIndex += 1) {
      const seed = (
        0x51e5a11 ^
        Math.imul(directionIndex + 1, 0x9e3779b1) ^
        Math.imul(seedIndex + 11, 0x85ebca6b)
      ) >>> 0;
      const recipe = surprise.surpriseBookRecipe({ direction: direction.id, seed });
      const preset = design.bookPreset(recipe.preset);
      const surfaceAudit = surprise.inspectBookSurpriseSurfaceComposition(recipe);
      const row = { seed, recipe, preset };
      row.signature = completeSignatureOf(row);
      rows.push(row);
      scores.push(recipe.score);
      signatureCounts.set(row.signature, (signatureCounts.get(row.signature) ?? 0) + 1);
      qualityCounts[recipe.quality] += 1;
      total += recipe.score;
      minimum = Math.min(minimum, recipe.score);
      maximum = Math.max(maximum, recipe.score);
      evaluatedCandidates += recipe.candidatesEvaluated;
      minimumCandidates = Math.min(minimumCandidates, recipe.candidatesEvaluated);
      maximumCandidates = Math.max(maximumCandidates, recipe.candidatesEvaluated);
      constraintViolations += recipe.constraintViolations;
      if (recipe.constraintViolations > 0) violatingSelections += 1;
      maximumViolations = Math.max(maximumViolations, recipe.constraintViolations);
      hardDiagnostics += recipe.diagnostics.filter((item) =>
        hardDiagnosticCodes.has(item.code),
      ).length;
      for (const item of recipe.diagnostics) {
        if (item.locked) continue;
        diagnosticHistogram.set(item.code, (diagnosticHistogram.get(item.code) ?? 0) + 1);
      }
      if (recipe.archetype === `${direction.id}-widened`) widenedSelections += 1;
      minimumSpineWidth = Math.min(minimumSpineWidth, recipe.style.thickness ?? 0);
      minimumSpineRatio = Math.min(
        minimumSpineRatio,
        (recipe.style.thickness ?? 0) / Math.max(1, recipe.style.height ?? 1),
      );
      if ((recipe.style.thickness ?? 0) < surprise.BOOK_SURPRISE_SPINE_WIDTH_FLOORS[direction.id]) {
        belowWidthFloor += 1;
      }
      if (
        (recipe.style.thickness ?? 0) / Math.max(1, recipe.style.height ?? 1) + 0.001 <
        surprise.BOOK_SURPRISE_SPINE_RATIO_FLOORS[direction.id]
      ) belowRatioFloor += 1;
      const ornament = recipe.style.ornament ?? -1;
      const medallion = recipe.style.coverMedallion ?? -1;
      if (ornament >= 0 && !surprise.BOOK_SURPRISE_EMBLEM_INDICES.includes(ornament)) {
        unsafeAutomaticEmblems += 1;
      }
      if (
        (ornament >= 0) !== (medallion >= 0) ||
        (ornament >= 0 && ornament !== medallion)
      ) mismatchedEmblems += 1;
      if (surfaceAudit.repeatedField) repeatedFields += 1;
      if (surfaceAudit.programmes.length > 1) stackedProgrammes += 1;
      if (
        recipe.style.charm !== 'none' ||
        recipe.style.cornerProtectors === true ||
        recipe.style.insetPlate === true
      ) appliedFurniture += 1;
      if ((recipe.style.raisedBands ?? 0) > 2) excessiveBands += 1;
      presetIds.add(preset.id);
      archetypes.add(recipe.archetype);
      shapes.add(preset.shape);
      materials.add(preset.material);
      palettes.add(`${recipe.style.spineBaseHex}/${recipe.style.coverBaseHex}`);
      plates.add(recipe.style.titlePlate);
      frames.add(recipe.style.coverFrame);
      ornaments.add(recipe.style.ornament);
      const layout = covers.coverCompositionLayout(
        recipe.style.titlePlate ?? 'label',
        recipe.style.coverFrame ?? 0,
        recipe.style.coverMedallion ?? 0,
        recipe.style.insetPlate === true,
      );
      compositions.add(
        `${layout.family}/${recipe.style.coverFrame < 15 ? 'plain' : recipe.style.coverFrame < 30 ? 'detailed' : recipe.style.coverFrame < 44 ? 'architectural' : 'ceremonial'}` +
        `/${recipe.style.cornerProtectors ? 'corners' : recipe.style.insetPlate ? 'inset' : 'clean'}`,
      );
      if (recipe.diagnostics.some((item) => item.locked)) lockedCompromises += 1;
      if (recipe.diagnostics.some((item) => item.code === 'duplicate-bands')) duplicateBands += 1;
    }

    // Two reproducible specimens from every authored archetype: its actual
    // lowest selected result and one distinct treatment from the production
    // best-minus-1.05 quality frontier. This displays the tail and the intended
    // ceiling without letting a visually easy grammar hide the others.
    const chosen = [];
    const expectedArchetypes = surprise.BOOK_SURPRISE_ARCHETYPES
      .filter((item) => item.direction === direction.id)
      .map((item) => item.id)
      .sort();
    for (const archetype of expectedArchetypes) {
      const family = rows.filter((row) => row.recipe.archetype === archetype);
      const worst = [...family].sort((a, b) => a.recipe.score - b.recipe.score || a.seed - b.seed)[0];
      if (!worst) continue;
      chosen.push(worst);
      const bestScore = Math.max(...family.map((row) => row.recipe.score));
      const frontier = family
        .filter((row) => row.recipe.score >= bestScore - 1.05 && row.signature !== worst.signature)
        .sort((a, b) => b.recipe.score - a.recipe.score || a.seed - b.seed);
      const elite = frontier[0] ?? family
        .filter((row) => row !== worst)
        .sort((a, b) => b.recipe.score - a.recipe.score || a.seed - b.seed)[0];
      if (elite) chosen.push(elite);
    }

    allRows.push(...chosen.map((row, sample) => ({ ...row, direction, sample })));
    const orderedScores = [...scores].sort((a, b) => a - b);
    const percentile = (fraction) => orderedScores[
      Math.min(orderedScores.length - 1, Math.floor(fraction * (orderedScores.length - 1)))
    ];
    const expectedPresets = [...direction.presetIds].sort();
    const reachedPresets = [...presetIds].sort();
    const reachedArchetypes = [...archetypes].sort();
    const missingPresets = expectedPresets.filter((id) => !presetIds.has(id));
    const missingArchetypes = expectedArchetypes.filter((id) => !archetypes.has(id));
    if (minimum < 90) failures.push(`${direction.id}: minimum score ${minimum} < 90`);
    if (violatingSelections > 0) failures.push(`${direction.id}: ${violatingSelections} violating selections`);
    if (hardDiagnostics > 0) failures.push(`${direction.id}: ${hardDiagnostics} hard diagnostics`);
    if (widenedSelections > 0) failures.push(`${direction.id}: ${widenedSelections} widened selections`);
    if (belowWidthFloor > 0) failures.push(`${direction.id}: ${belowWidthFloor} spines below width floor`);
    if (belowRatioFloor > 0) failures.push(`${direction.id}: ${belowRatioFloor} spines below ratio floor`);
    if (unsafeAutomaticEmblems > 0) failures.push(`${direction.id}: ${unsafeAutomaticEmblems} unsafe automatic emblems`);
    if (mismatchedEmblems > 0) failures.push(`${direction.id}: ${mismatchedEmblems} mismatched emblem pairs`);
    if (repeatedFields > 0) failures.push(`${direction.id}: ${repeatedFields} repeated material fields`);
    if (stackedProgrammes > 0) failures.push(`${direction.id}: ${stackedProgrammes} stacked focal programmes`);
    if (appliedFurniture > 0) failures.push(`${direction.id}: ${appliedFurniture} charm/hardware selections`);
    if (excessiveBands > 0) failures.push(`${direction.id}: ${excessiveBands} selections above two bands`);
    if (missingPresets.length > 0) failures.push(`${direction.id}: missing presets ${missingPresets.join(', ')}`);
    if (missingArchetypes.length > 0) failures.push(`${direction.id}: missing archetypes ${missingArchetypes.join(', ')}`);
    if (chosen.length !== expectedArchetypes.length * 2) {
      failures.push(`${direction.id}: selected ${chosen.length}/${expectedArchetypes.length * 2} board specimens`);
    }
    summaries.push({
      direction: direction.id,
      seeds: rows.length,
      expectedPresets,
      reachedPresets,
      missingPresets,
      expectedArchetypes,
      reachedArchetypes,
      missingArchetypes,
      score: {
        minimum: Math.round(minimum * 10) / 10,
        p01: percentile(0.01),
        p05: percentile(0.05),
        median: percentile(0.5),
        mean: Math.round((total / rows.length) * 10) / 10,
        p95: percentile(0.95),
        maximum: Math.round(maximum * 10) / 10,
      },
      qualityCounts,
      candidates: { total: evaluatedCandidates, minimum: minimumCandidates, maximum: maximumCandidates },
      constraints: {
        violatingSelections,
        maximumViolations,
        totalViolations: constraintViolations,
        hardDiagnostics,
        widenedSelections,
        lockedCompromises,
        duplicateBands,
        unsafeAutomaticEmblems,
        mismatchedEmblems,
        repeatedFields,
        stackedProgrammes,
        appliedFurniture,
        excessiveBands,
        unlockedDiagnosticHistogram: Object.fromEntries([...diagnosticHistogram.entries()].sort()),
      },
      spine: {
        widthFloor: surprise.BOOK_SURPRISE_SPINE_WIDTH_FLOORS[direction.id],
        ratioFloor: surprise.BOOK_SURPRISE_SPINE_RATIO_FLOORS[direction.id],
        minimumWidth: Math.round(minimumSpineWidth * 10) / 10,
        minimumRatio: Math.round(minimumSpineRatio * 1_000) / 1_000,
        belowWidthFloor,
        belowRatioFloor,
      },
      diversity: {
        uniquePresets: presetIds.size,
        uniqueArchetypes: archetypes.size,
        uniqueShapes: shapes.size,
        uniqueMaterials: materials.size,
        uniquePalettes: palettes.size,
        uniqueTitlePlates: plates.size,
        uniqueFrames: frames.size,
        uniqueOrnaments: ornaments.size,
        uniqueCompositions: compositions.size,
        uniqueCompleteSignatures: signatureCounts.size,
        maximumSignatureRepeat: Math.max(...signatureCounts.values()),
      },
    });
  }

  // Candidate-level audit: selected-output sweeps cannot prove that a bad
  // treatment is excluded before the weighted preset draw. Twelve independent
  // rosters per direction inspect every one of the six authored treatments.
  const treatmentAudit = {
    rosters: 0,
    treatments: 0,
    illegalTreatments: 0,
    ineligiblePresets: 0,
    minimumCandidateScore: Number.POSITIVE_INFINITY,
    treatmentCounts: new Set(),
    unsafeAutomaticEmblems: 0,
    mismatchedEmblems: 0,
    repeatedFields: 0,
    stackedProgrammes: 0,
    appliedFurniture: 0,
    excessiveBands: 0,
  };
  for (let directionIndex = 0; directionIndex < design.BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
    const direction = design.BOOK_SURPRISE_DIRECTIONS[directionIndex];
    for (let roster = 0; roster < 12; roster += 1) {
      const seed = (
        0x51e5a11 ^
        Math.imul(directionIndex + 1, 0x9e3779b1) ^
        Math.imul(roster + 0x62, 0x85ebca6b)
      ) >>> 0;
      const audit = surprise.inspectBookSurpriseSearch({ direction: direction.id, seed });
      treatmentAudit.rosters += 1;
      for (const preset of audit.presets) {
        treatmentAudit.treatments += preset.treatmentsEvaluated;
        treatmentAudit.illegalTreatments += preset.treatmentsEvaluated - preset.legalTreatments;
        if (!preset.structurallyEligible) treatmentAudit.ineligiblePresets += 1;
        treatmentAudit.minimumCandidateScore = Math.min(
          treatmentAudit.minimumCandidateScore,
          preset.minimumScore,
        );
        treatmentAudit.treatmentCounts.add(preset.treatmentsEvaluated);
        for (const treatment of preset.treatments) {
          const ornament = treatment.style.ornament ?? -1;
          const medallion = treatment.style.coverMedallion ?? -1;
          const surfaceAudit = surprise.inspectBookSurpriseSurfaceComposition({
            preset: preset.preset,
            style: treatment.style,
          });
          if (ornament >= 0 && !surprise.BOOK_SURPRISE_EMBLEM_INDICES.includes(ornament)) {
            treatmentAudit.unsafeAutomaticEmblems += 1;
          }
          if (
            (ornament >= 0) !== (medallion >= 0) ||
            (ornament >= 0 && ornament !== medallion)
          ) treatmentAudit.mismatchedEmblems += 1;
          if (surfaceAudit.repeatedField) treatmentAudit.repeatedFields += 1;
          if (surfaceAudit.programmes.length > 1) treatmentAudit.stackedProgrammes += 1;
          if (
            treatment.style.charm !== 'none' ||
            treatment.style.cornerProtectors === true ||
            treatment.style.insetPlate === true
          ) treatmentAudit.appliedFurniture += 1;
          if ((treatment.style.raisedBands ?? 0) > 2) treatmentAudit.excessiveBands += 1;
        }
      }
    }
  }
  if (treatmentAudit.illegalTreatments > 0) {
    failures.push(`candidate audit: ${treatmentAudit.illegalTreatments} illegal treatments`);
  }
  if (treatmentAudit.ineligiblePresets > 0) {
    failures.push(`candidate audit: ${treatmentAudit.ineligiblePresets} ineligible preset rosters`);
  }
  if (treatmentAudit.minimumCandidateScore < 82) {
    failures.push(`candidate audit: minimum score ${treatmentAudit.minimumCandidateScore} < 82`);
  }
  if ([...treatmentAudit.treatmentCounts].some((count) => count !== 6)) {
    failures.push(`candidate audit: treatment counts ${[...treatmentAudit.treatmentCounts].join(', ')}`);
  }
  for (const [key, value] of Object.entries({
    unsafeAutomaticEmblems: treatmentAudit.unsafeAutomaticEmblems,
    mismatchedEmblems: treatmentAudit.mismatchedEmblems,
    repeatedFields: treatmentAudit.repeatedFields,
    stackedProgrammes: treatmentAudit.stackedProgrammes,
    appliedFurniture: treatmentAudit.appliedFurniture,
    excessiveBands: treatmentAudit.excessiveBands,
  })) {
    if (value > 0) failures.push(`candidate audit: ${value} ${key}`);
  }

  document.body.innerHTML = '';
  document.body.style.cssText =
    `margin:0;padding:18px;background:${flat.FLAT.recess};color:${flat.FLAT.ink};` +
    'font:11px "Nunito Sans",system-ui,sans-serif;';
  const reportRoot = document.createElement('section');
  reportRoot.id = 'quality-report';
  const heading = document.createElement('h1');
  heading.textContent = 'Surprise — scored complete books';
  heading.style.cssText = 'margin:0 0 3px;font:600 28px "Caveat Variable",cursive;';
  const note = document.createElement('p');
  note.textContent =
    '512 seeds per direction · each authored family shown at its real tail and best-minus-1.05 frontier';
  note.style.cssText = 'margin:0 0 14px;opacity:.72;';
  const grid = document.createElement('main');
  grid.id = 'quality-board';
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,300px);gap:10px;align-items:start;';
  reportRoot.append(heading, note, grid);
  document.body.append(reportRoot);

  for (const row of allRows) {
    const resolved = style.resolveBookStyle(row.seed, undefined, row.recipe.style, {
      binding: row.recipe.preset,
    });
    const title = titlePool[row.sample % titlePool.length];
    const scale = Math.min(1, 194 / resolved.style.height);
    const bookH = resolved.style.height * scale;
    const boardW = bookH * 0.72;
    const spineW = resolved.style.thickness * scale;

    const cell = document.createElement('section');
    cell.style.cssText =
      'box-sizing:border-box;width:300px;padding:9px;background:#f5eee2;' +
      'border:1.5px solid #56392f;border-radius:13px 10px 14px 11px;';
    const header = document.createElement('header');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:7px;align-items:baseline;';
    const name = document.createElement('strong');
    name.textContent =
      `${row.direction.label} ${Math.floor(row.sample / 2) + 1} ${row.sample % 2 === 0 ? 'tail' : 'elite'}`;
    name.style.cssText = 'font:600 19px "Caveat Variable",cursive;';
    const score = document.createElement('b');
    score.textContent = `${row.recipe.score}`;
    score.style.cssText = `font-size:11px;color:${row.recipe.score >= 94 ? '#315b50' : '#7b3e46'};`;
    header.append(name, score);

    const art = document.createElement('div');
    art.style.cssText =
      'height:202px;display:flex;gap:10px;align-items:flex-end;justify-content:center;overflow:hidden;';
    const spine = document.createElement('canvas');
    spine.width = Math.ceil(spineW + 8);
    spine.height = 200;
    const spineContext = spine.getContext('2d');
    spines.renderSpine(
      spineContext,
      { ...resolved.spine, binding: row.recipe.preset },
      4,
      198 - bookH,
      bookH,
      scale,
      { hiRes: true },
    );
    const cover = document.createElement('canvas');
    cover.width = Math.ceil(boardW + 4);
    cover.height = 200;
    covers.renderCoverInto(cover.getContext('2d'), boardW, bookH, resolved.cover, title);
    cover.style.transform = `translateY(${198 - bookH}px)`;
    art.append(spine, cover);

    const binding = document.createElement('div');
    binding.textContent = `${row.preset.label} · ${row.preset.material}`;
    binding.title = binding.textContent;
    binding.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;';
    const finish = document.createElement('div');
    finish.textContent =
      `${row.recipe.archetype} · ${resolved.style.raisedBands} cords · ${resolved.style.titlePlate} · frame ${resolved.style.coverFrame} · ${resolved.style.charm}`;
    finish.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;opacity:.68;';
    const metrics = document.createElement('div');
    metrics.textContent =
      `seed ${row.seed} · v ${row.recipe.constraintViolations} · ` +
      `${resolved.style.thickness}×${resolved.style.height} · r ${(resolved.style.thickness / resolved.style.height).toFixed(3)}`;
    metrics.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;opacity:.68;';
    cell.append(header, art, binding, finish, metrics);
    grid.append(cell);
  }

  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    sweep: {
      recipes: summaries.reduce((sum, row) => sum + row.seeds, 0),
      seedsPerDirection: 512,
      candidatesEvaluated: summaries.reduce((sum, row) => sum + row.candidates.total, 0),
      candidateCountMinimum: Math.min(...summaries.map((row) => row.candidates.minimum)),
      candidateCountMaximum: Math.max(...summaries.map((row) => row.candidates.maximum)),
    },
    gate: {
      passed: failures.length === 0,
      failures,
      thresholds: {
        selectedScoreFloor: 90,
        candidateScoreFloor: 82,
        maximumConstraintViolations: 0,
        treatmentsPerPreset: 6,
      },
    },
    treatmentAudit: {
      rosters: treatmentAudit.rosters,
      treatments: treatmentAudit.treatments,
      illegalTreatments: treatmentAudit.illegalTreatments,
      ineligiblePresets: treatmentAudit.ineligiblePresets,
      minimumCandidateScore: treatmentAudit.minimumCandidateScore,
      treatmentCounts: [...treatmentAudit.treatmentCounts].sort((a, b) => a - b),
      unsafeAutomaticEmblems: treatmentAudit.unsafeAutomaticEmblems,
      mismatchedEmblems: treatmentAudit.mismatchedEmblems,
      repeatedFields: treatmentAudit.repeatedFields,
      stackedProgrammes: treatmentAudit.stackedProgrammes,
      appliedFurniture: treatmentAudit.appliedFurniture,
      excessiveBands: treatmentAudit.excessiveBands,
    },
    directions: summaries,
    specimens: allRows.map((row) => ({
      direction: row.direction.id,
      seed: row.seed,
      preset: row.recipe.preset,
      archetype: row.recipe.archetype,
      score: row.recipe.score,
      constraintViolations: row.recipe.constraintViolations,
      candidatesEvaluated: row.recipe.candidatesEvaluated,
      thickness: row.recipe.style.thickness,
      height: row.recipe.style.height,
      ratio: (row.recipe.style.thickness ?? 0) / Math.max(1, row.recipe.style.height ?? 1),
      completeSignature: row.signature,
      boardRole: row.sample % 2 === 0 ? 'archetype-tail' : 'archetype-frontier',
    })),
  };
});

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
// `locator.screenshot()` waits for element stability while scrolling, and a
// fixed-viewport clip silently truncated the last two direction rows. The
// report owns the page at this point, so a full-page capture is both stable and
// the only honest proof that every authored family was actually inspected.
await page.screenshot({ path: boardPath, fullPage: true });
console.log(`-> ${boardPath}`);
console.log(`-> ${reportPath}`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.gate.passed) {
  throw new Error(`Surprise quality gate failed:\n${report.gate.failures.join('\n')}`);
}
