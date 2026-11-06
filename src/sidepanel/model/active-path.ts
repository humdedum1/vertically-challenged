import type { Row } from './rows';

/**
 * For each row, the depths whose guide line runs along the active row's ancestor path.
 * Line j of a row is the guide of its ancestor at depth j, so it lights up when that
 * ancestor is also an ancestor of `at`. `at` is an index into `rows`; rows that aren't tabs
 * (or no `at`) get no lit guides. Rows of a tree are contiguous per branch, so the most
 * recent row at each depth is the ancestor at that depth.
 */
export function activePathDepths(rows: readonly Row[], at: number | undefined): number[][] {
  const out: number[][] = rows.map(() => []);
  const depthOf = (r: Row | undefined): number | undefined =>
    r?.kind === 'tab' ? (r.childDepth ?? 0) : undefined;
  if (at === undefined || depthOf(rows[at]) === undefined) return out;

  // Pass 1: ancestor index per depth for the active row.
  const latest: number[] = [];
  let activeAncestors: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const d = depthOf(rows[i]);
    if (d === undefined) continue;
    if (i === at) {
      activeAncestors = latest.slice(0, d);
      break;
    }
    latest[d] = i;
  }

  // Pass 2: a row's guide j is lit when its depth-j ancestor is on the active path.
  latest.length = 0;
  for (let i = 0; i < rows.length; i++) {
    const d = depthOf(rows[i]);
    if (d === undefined) continue;
    for (let j = 0; j < d; j++) {
      const ancestor = latest[j];
      if (ancestor !== undefined && ancestor === activeAncestors[j]) out[i]?.push(j);
    }
    latest[d] = i;
  }
  return out;
}
