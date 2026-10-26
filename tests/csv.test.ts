import { describe, expect, it } from "vitest";
import { parseRequirementsCsv, requirementsToCsv } from "../src/shared/csv.ts";
import { alloc, model, req, verify } from "./helpers.ts";

describe("requirements CSV", () => {
  it("round-trips requirements and their links", () => {
    const m = model({
      requirements: [req("AB-1", { title: 'Quoted "title", with comma' }), req("AB-2", { parentId: "AB-1" })],
      links: [alloc("AB-1", "X-1"), alloc("AB-1", "X-2"), verify("AB-2", "T-1")],
    });
    const parsed = parseRequirementsCsv(requirementsToCsv(m));
    expect(parsed.errors).toEqual([]);
    expect(parsed.requirements.map((r) => r.id)).toEqual(["AB-1", "AB-2"]);
    expect(parsed.requirements[0].title).toBe('Quoted "title", with comma');
    expect(parsed.requirements[1].parentId).toBe("AB-1");
    expect(parsed.links).toHaveLength(3);
  });

  it("neutralises cells that a spreadsheet would run as formulas", () => {
    const m = model({ requirements: [req("AB-1", { title: "=HYPERLINK(evil)" })] });
    const csv = requirementsToCsv(m);
    expect(csv).toContain("'=HYPERLINK(evil)");
    expect(parseRequirementsCsv(csv).requirements[0].title).toBe("=HYPERLINK(evil)");
  });

  it("reports invalid rows with row numbers instead of dropping them", () => {
    const csv = "id,title,priority\nAB-1,Fine title,high\nbad id,Ok title,high\nAB-3,No,urgent\n";
    const parsed = parseRequirementsCsv(csv);
    expect(parsed.requirements.map((r) => r.id)).toEqual(["AB-1"]);
    expect(parsed.errors.map((e) => e.row)).toEqual([3, 4, 4]);
  });

  it("requires id and title columns", () => {
    const parsed = parseRequirementsCsv("name,priority\nx,high\n");
    expect(parsed.errors[0].message).toMatch(/Missing required column "id"/);
  });

  it("detects duplicate IDs", () => {
    const parsed = parseRequirementsCsv("id,title\nAB-1,First one\nAB-1,Second one\n");
    expect(parsed.errors.some((e) => /Duplicate/.test(e.message))).toBe(true);
  });
});
