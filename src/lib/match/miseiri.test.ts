import { describe, it, expect } from "vitest";
import { stripQueryJunk } from "./normalize";
import { spacelessTrigramDice, jaroWinkler, tokenContainment } from "./similarity-extra";
import { scoreMiseiri } from "./score-miseiri";
import { decideMiseiri } from "./match-miseiri";

describe("stripQueryJunk", () => {
  it("strips role/location descriptors", () => {
    expect(stripQueryJunk("Carters Christchurch office")).toBe("carters christchurch");
    expect(stripQueryJunk("Smith Wellington branch")).toBe("smith wellington");
    expect(stripQueryJunk("Acme HQ")).toBe("acme");
  });

  it("strips bare numeric tokens", () => {
    expect(stripQueryJunk("Foo Store 47")).toBe("foo");
  });

  it("falls back to base when stripping leaves nothing", () => {
    expect(stripQueryJunk("Office")).toBe("office");
  });

  it("preserves entities without junk words", () => {
    expect(stripQueryJunk("Fonterra Cooperative Group Limited"))
      .toBe("fonterra cooperative group limited");
  });
});

describe("spacelessTrigramDice", () => {
  it("collapses boundary disagreements to 1.0", () => {
    expect(spacelessTrigramDice("AN Building", "A N Building")).toBe(1);
    expect(spacelessTrigramDice("McDonald", "Mc Donald")).toBe(1);
  });

  it("rewards typos within tokens", () => {
    expect(spacelessTrigramDice("Fontera", "Fonterra")).toBeGreaterThan(0.6);
  });

  it("penalises unrelated names", () => {
    expect(spacelessTrigramDice("Acme Industries", "Smith Family Trust")).toBeLessThan(0.2);
  });
});

describe("jaroWinkler", () => {
  it("scores identical strings as 1", () => {
    expect(jaroWinkler("Fonterra", "Fonterra")).toBe(1);
  });

  it("rewards shared prefix", () => {
    const withPrefix = jaroWinkler("Fontera", "Fonterra");
    const withoutPrefix = jaroWinkler("XYZera", "Fonterra");
    expect(withPrefix).toBeGreaterThan(withoutPrefix);
  });
});

describe("tokenContainment", () => {
  it("is 1.0 when query tokens are all in candidate (truncation)", () => {
    expect(tokenContainment("Acme Industries", "Acme Industries Holdings Limited")).toBe(1);
  });

  it("is asymmetric — extra query tokens reduce score", () => {
    expect(tokenContainment("Carters Christchurch office", "Carters Christchurch")).toBeCloseTo(2 / 3, 2);
  });

  it("zero on no overlap", () => {
    expect(tokenContainment("Smith", "Jones")).toBe(0);
  });
});

describe("scoreMiseiri", () => {
  it("scores AN Building vs A N Building Limited substantially better than default would", () => {
    // Default blend lands this case ~0.56. Trigram nails it (1.0) and
    // levenshtein helps (~0.92), but asymmetric containment penalises
    // because "an" doesn't appear as a substring of any candidate token.
    // Result: well above default but not auto-match territory.
    const s = scoreMiseiri({ query: "AN Building", candidateName: "A N Building Limited" });
    expect(s.total).toBeGreaterThan(0.7);
  });

  it("scores Carters Christchurch vs Carters Christchurch Limited as exact (1.0)", () => {
    const s = scoreMiseiri({ query: "Carters Christchurch", candidateName: "Carters Christchurch Limited" });
    // limited is stripped in normalization → exact match
    expect(s.total).toBe(1);
  });

  it("typo'd-prefix-of-truncated case lands in needs_review territory, not zero", () => {
    // "Fontera" → "Fonterra Cooperative Group" is the canonical hard
    // case: typo within first token AND truncation. Deterministic
    // matchers can't fully recover this — that's the LLM/MCP path's
    // job. We only assert the score is non-trivial, not auto-match.
    const s = scoreMiseiri({ query: "Fontera", candidateName: "Fonterra Cooperative Group Limited" });
    expect(s.total).toBeGreaterThan(0.3);
  });
});

describe("decideMiseiri — sibling-cluster trap", () => {
  it("flags near-tied high-confidence candidates as DUPLICATE_ENTITIES", () => {
    const candidates = [
      { nzbn: "1", entityName: "Smith Family Trust" },
      { nzbn: "2", entityName: "Smith Family Trust" },
      { nzbn: "3", entityName: "Smith Family Trust" },
    ];
    const out = decideMiseiri({ query: "Smith Family Trust", candidates });
    expect(out.status).toBe("needs_review");
    expect(out.reviewReason).toBe("DUPLICATE_ENTITIES");
  });

  it("auto-matches a clear winner above threshold with sufficient gap", () => {
    const candidates = [
      { nzbn: "1", entityName: "Fonterra Cooperative Group" },
      { nzbn: "2", entityName: "Acme Industries" },
    ];
    const out = decideMiseiri({ query: "Fonterra Cooperative Group", candidates });
    expect(out.status).toBe("matched");
  });

  it("returns not_found on empty candidate list", () => {
    const out = decideMiseiri({ query: "Anything", candidates: [] });
    expect(out.status).toBe("not_found");
  });
});
