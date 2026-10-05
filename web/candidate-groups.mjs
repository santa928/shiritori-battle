import { meaningEquivalences } from './meaning-equivalences.mjs?v=20261005-meaning3';
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values) => [...new Set(values)].sort(compare);
const same = (a, b) =>
  JSON.stringify([...(a ?? [])].sort(compare)) === JSON.stringify([...(b ?? [])].sort(compare));
function matches(candidate, member, rule) {
  return (
    candidate.eligible === true &&
    candidate.source?.id === rule.sourceId &&
    candidate.entryId === member.entryId &&
    candidate.senseId === member.senseId &&
    candidate.sourceUrl === member.sourceUrl &&
    candidate.readings?.includes(rule.reading) &&
    same(candidate.spellings, member.spellings) &&
    same(candidate.pos, member.pos) &&
    candidate.definitions?.every((d) => d.language === 'ja') &&
    same(
      candidate.definitions.map((d) => d.text),
      member.definitions,
    )
  );
}
// Presentation only: evidence and game eligibility remain on the untouched candidates.
// A stale or partially present mapping fails closed; no spelling/reading inference.
export function groupCandidates(candidates = [], reading) {
  const ordered = [...candidates].sort((a, b) =>
    compare(JSON.stringify([a.entryId, a.senseId, a]), JSON.stringify([b.entryId, b.senseId, b])),
  );
  const assigned = new Map();
  for (const rule of meaningEquivalences) {
    if (reading !== undefined && reading !== rule.reading) continue;
    const members = rule.members.map((member) => ordered.filter((c) => matches(c, member, rule)));
    if (
      !members
        .flat()
        .some(
          (c) =>
            c.entryId === rule.primaryMember?.entryId && c.senseId === rule.primaryMember?.senseId,
        ) ||
      members.some((found) => found.length !== 1) ||
      members.flat().some((c) => assigned.has(c))
    )
      continue;
    for (const c of members.flat()) assigned.set(c, rule);
  }
  const grouped = new Map();
  for (const c of ordered) {
    const rule = assigned.get(c),
      key = rule ?? c;
    if (!grouped.has(key)) grouped.set(key, { rule, candidates: [] });
    grouped.get(key).candidates.push(c);
  }
  return [...grouped.values()].map(({ rule, candidates: members }) => {
    const first = members[0],
      matchReading = reading ?? first.readings?.[0];
    const spelling =
      rule?.representative ??
      first.spellings?.find((x) => x !== matchReading) ??
      first.spellings?.[0] ??
      'ことば';
    const primary = rule
      ? members.find(
          (c) =>
            c.entryId === rule.primaryMember.entryId && c.senseId === rule.primaryMember.senseId,
        )
      : first;
    const primaryDefinitions = (primary.definitions ?? [])
      .filter((d) => d.language === 'ja')
      .map((d) => d.text);
    return {
      spelling,
      aliases: sorted(members.flatMap((c) => c.spellings ?? []).filter((s) => s !== spelling)),
      definitions: [
        ...new Set([
          ...primaryDefinitions,
          ...sorted(
            members.flatMap((c) =>
              (c.definitions ?? []).filter((d) => d.language === 'ja').map((d) => d.text),
            ),
          ),
        ]),
      ],
      sources: sorted(members.map((c) => c.sourceUrl).filter(Boolean)),
      candidates: structuredClone(members),
    };
  });
}
