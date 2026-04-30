// Token-level diff for the per-row "input vs matched legal name" view.
// Word-granularity LCS — fine for short company names.

export type DiffPart = { text: string; kind: "same" | "removed" | "added" };

export function tokenDiff(a: string, b: string): { left: DiffPart[]; right: DiffPart[] } {
  const at = tokenize(a);
  const bt = tokenize(b);
  const lcs = lcsMatrix(at.map(t => t.toLowerCase()), bt.map(t => t.toLowerCase()));
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  let i = at.length, j = bt.length;
  while (i > 0 && j > 0) {
    if (at[i - 1].toLowerCase() === bt[j - 1].toLowerCase()) {
      left.unshift({ text: at[i - 1], kind: "same" });
      right.unshift({ text: bt[j - 1], kind: "same" });
      i--; j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      left.unshift({ text: at[i - 1], kind: "removed" });
      i--;
    } else {
      right.unshift({ text: bt[j - 1], kind: "added" });
      j--;
    }
  }
  while (i > 0) { left.unshift({ text: at[i - 1], kind: "removed" }); i--; }
  while (j > 0) { right.unshift({ text: bt[j - 1], kind: "added" }); j--; }
  return { left, right };
}

function tokenize(s: string): string[] {
  // Keep punctuation as its own token so diffs don't merge "&" into a word.
  return (s ?? "").match(/[A-Za-z0-9']+|[^\sA-Za-z0-9']/g) ?? [];
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}
