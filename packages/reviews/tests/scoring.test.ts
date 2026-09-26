import { describe, expect, test } from "bun:test";
import {
  ReviewScoringError,
  ReviewScoringErrorCode,
  scoreReview,
} from "../index.js";
import type { ReviewScoringRubric } from "../index.js";

describe("review scoring", () => {
  const rubric: ReviewScoringRubric = {
    version: "rubric-1",
    controls: [
      { id: "architecture", weight: 3 },
      { id: "security", weight: 1 },
    ],
  };

  test("is deterministic and returns controls in rubric order", () => {
    const first = scoreReview(rubric, [
      { controlId: "security", outcome: "unmet" },
      { controlId: "architecture", outcome: "met" },
    ]);
    const second = scoreReview(rubric, [
      { controlId: "architecture", outcome: "met" },
      { controlId: "security", outcome: "unmet" },
    ]);

    expect(first).toEqual(second);
    expect(first.controls.map(({ controlId }) => controlId)).toEqual(["architecture", "security"]);
    expect(first.scoreBasisPoints).toBe(7500);
    expect(first.evidenceCoverageBasisPoints).toBe(10000);
  });

  test("insufficient evidence contributes zero readiness and lowers coverage", () => {
    const result = scoreReview(rubric, [
      { controlId: "architecture", outcome: "met" },
      { controlId: "security", outcome: "insufficient_evidence" },
    ]);

    expect(result.scoreBasisPoints).toBe(7500);
    expect(result.evidenceCoverageBasisPoints).toBe(7500);
    expect(result.controls[1]?.outcome).toBe("insufficient_evidence");
  });

  test("snapshots and freezes result data against caller mutation", () => {
    const mutableRubric = { version: "v1", controls: [{ id: "one", weight: 1 }] };
    const mutableOutcomes = [{ controlId: "one", outcome: "met" as const }];
    const result = scoreReview(mutableRubric, mutableOutcomes);
    mutableRubric.controls[0]!.id = "tampered";
    mutableOutcomes[0]!.outcome = "unmet";

    expect(result.controls[0]?.controlId).toBe("one");
    expect(result.controls[0]?.outcome).toBe("met");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.controls)).toBe(true);
    expect(Object.isFrozen(result.controls[0])).toBe(true);
  });

  test.each([
    ["missing outcome", [{ controlId: "architecture", outcome: "met" }], ReviewScoringErrorCode.MISSING_OUTCOME],
    ["unknown control", [
      { controlId: "architecture", outcome: "met" },
      { controlId: "other", outcome: "unmet" },
    ], ReviewScoringErrorCode.UNKNOWN_CONTROL],
    ["duplicate outcome", [
      { controlId: "architecture", outcome: "met" },
      { controlId: "architecture", outcome: "unmet" },
      { controlId: "security", outcome: "met" },
    ], ReviewScoringErrorCode.DUPLICATE_OUTCOME],
    ["invalid outcome", [
      { controlId: "architecture", outcome: "maybe" },
      { controlId: "security", outcome: "met" },
    ], ReviewScoringErrorCode.INVALID_OUTCOME],
  ] as const)("rejects %s", (_label, outcomes, code) => {
    expectScoringError(() => scoreReview(rubric, outcomes as never), code);
  });

  test.each([
    ["empty version", { ...rubric, version: " " }],
    ["duplicate control IDs", { version: "v1", controls: [{ id: "same", weight: 1 }, { id: "same", weight: 2 }] }],
    ["zero weight", { version: "v1", controls: [{ id: "one", weight: 0 }] }],
    ["fractional weight", { version: "v1", controls: [{ id: "one", weight: 1.5 }] }],
    ["unsafe weight", { version: "v1", controls: [{ id: "one", weight: Number.MAX_SAFE_INTEGER + 1 }] }],
    ["unsafe aggregate", { version: "v1", controls: [{ id: "one", weight: Number.MAX_SAFE_INTEGER }, { id: "two", weight: 1 }] }],
    ["empty controls", { version: "v1", controls: [] }],
  ] as const)("rejects rubric with %s", (_label, invalidRubric) => {
    expectScoringError(() => scoreReview(invalidRubric as never, []),
      "unsafe aggregate" === _label ? ReviewScoringErrorCode.UNSAFE_TOTAL_WEIGHT : ReviewScoringErrorCode.INVALID_RUBRIC);
  });

  test("rounds exact integer ratios half up at basis-point boundaries", () => {
    const result = scoreReview(
      { version: "v1", controls: [{ id: "met", weight: 1 }, { id: "unmet-a", weight: 1 }, { id: "unmet-b", weight: 1 }] },
      [
        { controlId: "met", outcome: "met" },
        { controlId: "unmet-a", outcome: "unmet" },
        { controlId: "unmet-b", outcome: "unmet" },
      ],
    );
    expect(result.scoreBasisPoints).toBe(3333);
    expect(result.evidenceCoverageBasisPoints).toBe(10000);
    expect(scoreReview({ version: "v1", controls: [{ id: "met", weight: 1 }, { id: "missing", weight: 1 }] }, [
      { controlId: "met", outcome: "met" },
      { controlId: "missing", outcome: "insufficient_evidence" },
    ]).scoreBasisPoints).toBe(5000);
  });
});

function expectScoringError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReviewScoringError);
  expect((thrown as ReviewScoringError).code).toBe(code);
}
