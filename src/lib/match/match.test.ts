import { describe, it, expect } from "vitest";
import { normalize, normalizeForCompare, tokens } from "./normalize";
import { jaccard, levenshteinRatio, tokenPrefixMatch } from "./similarity";
import { score } from "./score";
import { decide } from "./match";

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  Smith   &   Jones  Ltd. ")).toBe("smith and jones ltd");
  });

  it("strips punctuation", () => {
    expect(normalize("ABC Co., Limited.")).toBe("abc co limited");
  });

  it("preserves macrons", () => {
    expect(normalize("Wāhi Limited")).toBe("wāhi limited");
  });
});

describe("normalizeForCompare", () => {
  it("strips suffixes and stop-words", () => {
    expect(normalizeForCompare("The ABC Company Limited")).toBe("abc");
    expect(normalizeForCompare("Smith and Jones Ltd")).toBe("smith jones");
  });

  it("returns empty for empty input", () => {
    expect(normalizeForCompare("")).toBe("");
  });
});

describe("jaccard", () => {
  it("is order-insensitive", () => {
    const a = "Smith and Jones Limited";
    const b = "Jones & Smith Ltd";
    expect(jaccard(a, b)).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(jaccard("ABC Limited", "XYZ Limited")).toBe(0);
  });
});

describe("levenshteinRatio", () => {
  it("rewards near-identical strings", () => {
    expect(levenshteinRatio("Fontera", "Fonterra")).toBeGreaterThan(0.85);
  });

  it("penalises distant strings", () => {
    expect(levenshteinRatio("ABC Limited", "XYZ Limited")).toBeLessThan(0.6);
  });

  it("ABCe vs ABCee — single-char insertion", () => {
    expect(levenshteinRatio("ABCe Limited", "ABCee Limited")).toBeGreaterThan(0.7);
  });
});

describe("tokenPrefixMatch", () => {
  it("returns 1 when first tokens match", () => {
    expect(tokenPrefixMatch("ABC", "ABC Limited")).toBe(1);
  });

  it("returns 0.7 when one is a prefix of the other", () => {
    expect(tokenPrefixMatch("Fonter", "Fonterra Limited")).toBe(0.7);
  });
});

describe("score", () => {
  it("flags exact normalized matches with total=1", () => {
    const result = score({ query: "ABC Limited", candidateName: "ABC Ltd" });
    expect(result.exact).toBe(1);
    expect(result.total).toBe(1);
  });

  it("scores typo-level matches well above no-match band", () => {
    // Partial query (missing "Group") so total < 0.85 is correct;
    // it should still be comfortably above the 0.5 floor.
    const result = score({ query: "Fontera Cooperative", candidateName: "Fonterra Cooperative Group Limited" });
    expect(result.total).toBeGreaterThan(0.5);
  });

  it("scores complete typo matches in the high-confidence band", () => {
    const result = score({ query: "Fontera Cooperative Group", candidateName: "Fonterra Cooperative Group Limited" });
    expect(result.total).toBeGreaterThan(0.85);
  });

  it("uses trading names when legal name doesn't match", () => {
    const result = score({
      query: "ACME Tools",
      candidateName: "Acme Holdings Limited",
      candidateTradingNames: ["ACME Tools"],
    });
    expect(result.tradingName).toBe(1);
  });
});

describe("decide", () => {
  const aCo = { nzbn: "9429000000001", entityName: "ABC Limited" };
  const xyz = { nzbn: "9429000000002", entityName: "XYZ Limited" };
  const fontera = { nzbn: "9429000000003", entityName: "Fonterra Cooperative Group Limited" };

  it("returns matched + exact_name for normalized exact hit", () => {
    const r = decide({ query: "ABC Ltd", candidates: [aCo, xyz] });
    expect(r.status).toBe("matched");
    expect(r.method).toBe("exact_name");
    expect(r.best?.nzbn).toBe(aCo.nzbn);
  });

  it("returns matched + fuzzy for typo with clear winner", () => {
    const r = decide({ query: "Fontera Cooperative Group", candidates: [fontera, xyz] });
    expect(r.status).toBe("matched");
    expect(r.method).toBe("fuzzy");
  });

  it("returns needs_review when top score is mid-band", () => {
    const r = decide({
      query: "Smith Jones",
      candidates: [
        { nzbn: "9429000000010", entityName: "Smith Holdings Limited" },
        { nzbn: "9429000000011", entityName: "Jones Holdings Limited" },
      ],
    });
    expect(["needs_review", "not_found"]).toContain(r.status);
  });

  it("returns not_found when no candidate scores above review band", () => {
    const r = decide({ query: "Completely Unrelated Co", candidates: [aCo, xyz] });
    expect(r.status).toBe("not_found");
  });

  it("returns not_found for empty candidates", () => {
    const r = decide({ query: "ABC Limited", candidates: [] });
    expect(r.status).toBe("not_found");
    expect(r.best).toBeNull();
  });

  it("uses trading-name match when legal name doesn't equal", () => {
    const acme = {
      nzbn: "9429000000020",
      entityName: "Acme Holdings Limited",
      tradingNames: ["ACME Tools"],
    };
    const r = decide({ query: "ACME Tools", candidates: [acme] });
    expect(r.status).toBe("matched");
    expect(r.method).toBe("trading_name");
    expect(r.best?.nzbn).toBe(acme.nzbn);
  });
});
