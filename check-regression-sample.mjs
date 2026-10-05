#!/usr/bin/env node
/**
 * Reproducible, source-pinned dictionary audit. Place beside dictionary.mjs.
 * Usage: node check-regression-sample.mjs DATA.json [SAMPLE.json] [REPORT.json]
 * Optional --module PATH selects the dictionary module for an out-of-tree audit.
 * Nonzero exit: broken source pin, lost supported meaning, or failed control.
 * Missing/ambiguous source cases are measured, not silently changed to accepts.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function auditSample(data, sample, { createDictionary, normalizeReading }) {
  if (
    sample.schemaVersion !== 1 ||
    sample.positiveSamples.length < 300 ||
    sample.controls.length < 20
  )
    throw new Error('Expected at least 300 positive samples and 20 controls');
  if (!data.sources.some((s) => s.id === sample.source.id && s.sha256 === sample.source.sha256))
    throw new Error('Source snapshot mismatch: review sample IDs before updating the pin');
  const inputs = [
    ...sample.positiveSamples.map((s) => s.expectedReading),
    ...sample.controls.map((s) => s.input),
  ];
  const wanted = new Set(inputs.map(normalizeReading).filter(Boolean));
  // Filtering by reading preserves every candidate for every tested input.
  const db = createDictionary({
    ...data,
    entries: data.entries.filter((e) => e.readings.some((r) => wanted.has(normalizeReading(r)))),
  });
  const matches = (candidate, ref) =>
    candidate.entryId === ref.entryId && (ref.senseId === '*' || candidate.senseId === ref.senseId);
  const positives = sample.positiveSamples.map((row) => {
    const found = db.lookup(row.expectedReading);
    const eligible = found.candidates.filter((c) => c.eligible);
    const sourceMatched = eligible.filter((c) =>
      row.acceptedSenseEvidence.some((ref) => matches(c, ref)),
    );
    const intendedGeo = row.category.includes('geography');
    const exact = eligible.filter(
      (c) => c.spellings.includes(row.spelling) && (!intendedGeo || c.labels.includes('place')),
    );
    return {
      id: row.id,
      category: row.category,
      spelling: row.spelling,
      reading: row.expectedReading,
      expectation: row.expectedAcceptance,
      lookupStatus: found.status,
      sourceBackedIntendedMeaning: sourceMatched.length > 0,
      strictSpellingEligibleMeaning: exact.length > 0,
      anyEligibleReading: eligible.length > 0,
      expectedKnownMeaning: row.acceptedSenseEvidence.length > 0,
      regression: row.acceptedSenseEvidence.length > 0 && sourceMatched.length === 0,
      matchedSourceSenses: sourceMatched.map((c) => ({ entryId: c.entryId, senseId: c.senseId })),
      eligibleCandidates: eligible.map((c) => ({
        entryId: c.entryId,
        senseId: c.senseId,
        spellings: c.spellings,
        definitions: c.definitions,
        sourceUrl: c.sourceUrl,
      })),
    };
  });
  const controls = sample.controls.map((row) => {
    const found = db.lookup(row.input);
    const eligible = found.candidates.filter((c) => c.eligible);
    const leaks = eligible.filter((c) =>
      row.forbiddenEligibleSenses.some((ref) => matches(c, ref)),
    );
    const absentRequired = row.requiredEligibleSenses.filter(
      (ref) => !eligible.some((c) => matches(c, ref)),
    );
    const statusMismatch = Boolean(
      row.requiredLookupStatus && found.status !== row.requiredLookupStatus,
    );
    const exercised = Boolean(
      row.requiredLookupStatus ||
      row.requiredEligibleSenses.length ||
      found.candidates.some((c) => row.forbiddenEligibleSenses.some((ref) => matches(c, ref))) ||
      row.kind === 'unused-character-reading',
    );
    return {
      id: row.id,
      spelling: row.spelling,
      input: row.input,
      kind: row.kind,
      lookupStatus: found.status,
      verdict:
        leaks.length || absentRequired.length || statusMismatch
          ? 'fail'
          : exercised
            ? 'pass'
            : 'unexercised-missing-or-ambiguous',
      leakedEligibleSenses: leaks.map((c) => ({ entryId: c.entryId, senseId: c.senseId })),
      absentRequired,
      statusMismatch,
    };
  });
  const count = (rows, key) => rows.filter((r) => r[key]).length;
  const byCategory = Object.fromEntries(
    [...new Set(positives.map((r) => r.category))].map((cat) => {
      const rows = positives.filter((r) => r.category === cat);
      return [
        cat,
        {
          total: rows.length,
          intendedMeanings: count(rows, 'sourceBackedIntendedMeaning'),
          strictSpellings: count(rows, 'strictSpellingEligibleMeaning'),
          anyEligibleReadings: count(rows, 'anyEligibleReading'),
        },
      ];
    }),
  );
  const summary = {
    totalSamples: positives.length,
    sourceBackedIntendedMeanings: count(positives, 'sourceBackedIntendedMeaning'),
    requiredKnownMeanings: count(positives, 'expectedKnownMeaning'),
    strictSpellingMatches: count(positives, 'strictSpellingEligibleMeaning'),
    anyEligibleReadings: count(positives, 'anyEligibleReading'),
    unresolvedSampleExpectations:
      count(positives, 'expectedKnownMeaning') === positives.length
        ? 0
        : positives.filter((r) => !r.expectedKnownMeaning).length,
    positiveRegressions: positives
      .filter((r) => r.regression)
      .map((r) => ({ id: r.id, spelling: r.spelling, reading: r.reading })),
    byCategory,
    totalControls: controls.length,
    passedControls: controls.filter((r) => r.verdict === 'pass').length,
    unexercisedControls: controls.filter((r) => r.verdict.startsWith('unexercised')).length,
    failedControls: controls.filter((r) => r.verdict === 'fail').map((r) => r.id),
  };
  return { source: sample.source, summary, positives, controls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let moduleUrl = new URL('./dictionary.mjs', import.meta.url);
  const index = args.indexOf('--module');
  if (index !== -1) {
    if (!args[index + 1]) throw new Error('--module requires PATH');
    moduleUrl = pathToFileURL(resolve(args[index + 1]));
    args.splice(index, 2);
  }
  const [dataPath, samplePath, reportPath] = args;
  if (!dataPath)
    throw new Error(
      'Usage: node check-regression-sample.mjs DATA.json [SAMPLE.json] [REPORT.json] [--module PATH]',
    );
  const sample = JSON.parse(
    await readFile(samplePath || new URL('./regression-sample.json', import.meta.url), 'utf8'),
  );
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const report = auditSample(data, sample, await import(moduleUrl));
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.positiveRegressions.length || report.summary.failedControls.length)
    process.exitCode = 1;
}
