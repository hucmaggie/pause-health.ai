import { describe, expect, it } from "vitest";
import {
  DEMO_PRIOR_AUTH_REQUEST,
  PRIOR_AUTH_ITEMS,
  SUPPORTING_DOCUMENTS,
  type PriorAuthRequest,
  assemblePriorAuth,
  assembleSupportingDocs,
  getPriorAuthItem,
  isCatalogItem,
  matchPayerCriteria,
  priorAuthDocumentationComplete,
  priorAuthHasClinicianApproval,
  priorAuthSummary,
  submitPriorAuth
} from "./prior-auth";

/**
 * Tests for lib/prior-auth.ts — the deterministic prior-authorization assembly
 * engine behind the Prior Authorization Agent. Assembly is a pure function of
 * the request (no randomness, no clock), so the same request always yields the
 * same package. These pin determinism, criteria matching, documentation-
 * completeness detection (complete vs missing), the clinician-gated / not-
 * submitted package shape, off-catalog rejection, and the two honesty signals.
 */

function baseHrtRequest(
  overrides: Partial<PriorAuthRequest> = {}
): PriorAuthRequest {
  return {
    itemId: "pa.systemic-hrt",
    member: { memberId: "m-1", planId: "p-1", payer: "Aetna" },
    clinicalContext: {
      moderateToSevereSymptoms: true,
      contraindicationsScreened: true,
      conservativeMeasuresTried: true
    },
    attachedDocuments: [
      "doc.clinical-notes",
      "doc.diagnosis-code",
      "doc.medication-history"
    ],
    ...overrides
  };
}

describe("prior-authorization catalog", () => {
  it("exposes a non-empty item catalog with stable ids + criteria + required docs", () => {
    expect(PRIOR_AUTH_ITEMS.length).toBeGreaterThan(0);
    const docIds = new Set(SUPPORTING_DOCUMENTS.map((d) => d.id));
    for (const item of PRIOR_AUTH_ITEMS) {
      expect(item.id).toMatch(/^pa\./);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.criteria.length).toBeGreaterThan(0);
      expect(item.requiredDocumentation.length).toBeGreaterThan(0);
      for (const c of item.criteria) {
        expect(c.id).toMatch(/^pa\./);
        expect(c.description.length).toBeGreaterThan(0);
      }
      // Every required document references a defined supporting-document id.
      for (const docId of item.requiredDocumentation) {
        expect(docIds.has(docId), docId).toBe(true);
      }
    }
  });

  it("includes the three PA-requiring items", () => {
    const ids = PRIOR_AUTH_ITEMS.map((i) => i.id);
    expect(ids).toContain("pa.systemic-hrt");
    expect(ids).toContain("pa.dexa-bone-density");
    expect(ids).toContain("pa.hormone-lab-panel");
  });

  it("isCatalogItem / getPriorAuthItem agree with the catalog", () => {
    for (const item of PRIOR_AUTH_ITEMS) {
      expect(isCatalogItem(item.id)).toBe(true);
      expect(getPriorAuthItem(item.id)?.label).toBe(item.label);
    }
    expect(isCatalogItem("pa.totally-made-up")).toBe(false);
    expect(getPriorAuthItem("pa.totally-made-up")).toBeUndefined();
  });
});

describe("assemblePriorAuth · determinism + package shape", () => {
  it("is deterministic — the same request yields the same package", () => {
    expect(assemblePriorAuth(baseHrtRequest())).toEqual(
      assemblePriorAuth(baseHrtRequest())
    );
  });

  it("always returns a clinician-gated, not-submitted package", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    expect(pkg.requiresClinicianApproval).toBe(true);
    expect(pkg.submitted).toBe(false);
    // assembly never submits — status is only draft | ready-for-clinician.
    expect(["draft", "ready-for-clinician"]).toContain(pkg.status);
  });

  it("references catalog criteria + carries synthetic provenance", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    expect(pkg.criteria.map((c) => c.criteriaId)).toEqual(
      item.criteria.map((c) => c.id)
    );
    expect(pkg.source.synthetic).toBe(true);
    expect(pkg.source.careRequestId).toMatch(/^care-req-/);
    expect(pkg.source.authorizationId).toMatch(/^pa-/);
  });

  it("rejects an off-catalog item", () => {
    expect(() =>
      assemblePriorAuth(baseHrtRequest({ itemId: "pa.made-up" }))
    ).toThrow(/off-catalog/i);
  });
});

describe("matchPayerCriteria · deterministic criteria matching", () => {
  it("marks all criteria met when the clinical context satisfies them (HRT)", () => {
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    const matched = matchPayerCriteria(item, {
      moderateToSevereSymptoms: true,
      contraindicationsScreened: true,
      conservativeMeasuresTried: true
    });
    expect(matched.every((c) => c.met)).toBe(true);
  });

  it("marks a criterion unmet when its clinical fact is missing", () => {
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    const matched = matchPayerCriteria(item, {
      moderateToSevereSymptoms: true,
      contraindicationsScreened: false,
      conservativeMeasuresTried: true
    });
    const unmet = matched.filter((c) => !c.met);
    expect(unmet.map((c) => c.criteriaId)).toContain(
      "pa.hrt.contraindications-screened"
    );
  });

  it("fails the DEXA re-screen interval when a prior DEXA is within the interval", () => {
    const item = getPriorAuthItem("pa.dexa-bone-density")!;
    const withinInterval = matchPayerCriteria(item, {
      postmenopausalWithRiskFactor: true,
      priorDexaWithinInterval: true
    });
    expect(
      withinInterval.find((c) => c.criteriaId === "pa.dexa.interval")?.met
    ).toBe(false);

    const outsideInterval = matchPayerCriteria(item, {
      postmenopausalWithRiskFactor: true,
      priorDexaWithinInterval: false
    });
    expect(outsideInterval.every((c) => c.met)).toBe(true);
  });
});

describe("assembleSupportingDocs · documentation-completeness detection", () => {
  it("detects a complete checklist when every required doc is attached", () => {
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    const docs = assembleSupportingDocs(item, item.requiredDocumentation);
    expect(docs.complete).toBe(true);
    expect(docs.missing).toEqual([]);
    expect(docs.present.length).toBe(item.requiredDocumentation.length);
    expect(docs.checklist.every((c) => c.present)).toBe(true);
  });

  it("detects the missing documents when some are absent", () => {
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    const docs = assembleSupportingDocs(item, ["doc.clinical-notes"]);
    expect(docs.complete).toBe(false);
    expect(docs.present).toEqual(["doc.clinical-notes"]);
    expect(docs.missing).toContain("doc.diagnosis-code");
    expect(docs.missing).toContain("doc.medication-history");
  });

  it("treats no attached documents as everything missing", () => {
    const item = getPriorAuthItem("pa.systemic-hrt")!;
    const docs = assembleSupportingDocs(item, undefined);
    expect(docs.complete).toBe(false);
    expect(docs.missing.length).toBe(item.requiredDocumentation.length);
  });
});

describe("assemblePriorAuth · status derivation", () => {
  it("is ready-for-clinician when all criteria met AND docs complete", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    expect(pkg.criteriaComplete).toBe(true);
    expect(pkg.documentation.complete).toBe(true);
    expect(pkg.status).toBe("ready-for-clinician");
    expect(pkg.submitted).toBe(false);
  });

  it("is a draft when documentation is incomplete", () => {
    const pkg = assemblePriorAuth(
      baseHrtRequest({ attachedDocuments: ["doc.clinical-notes"] })
    );
    expect(pkg.documentation.complete).toBe(false);
    expect(pkg.status).toBe("draft");
  });

  it("is a draft when a payer criterion is unmet", () => {
    const pkg = assemblePriorAuth(
      baseHrtRequest({
        clinicalContext: {
          moderateToSevereSymptoms: true,
          contraindicationsScreened: false,
          conservativeMeasuresTried: true
        }
      })
    );
    expect(pkg.criteriaComplete).toBe(false);
    expect(pkg.status).toBe("draft");
  });

  it("the demo request assembles to a complete, ready-for-clinician package", () => {
    const pkg = assemblePriorAuth(DEMO_PRIOR_AUTH_REQUEST);
    expect(pkg.status).toBe("ready-for-clinician");
    expect(pkg.submitted).toBe(false);
    expect(pkg.requiresClinicianApproval).toBe(true);
  });
});

describe("priorAuthHasClinicianApproval · no-autonomous-submission signal", () => {
  it("is true for an assemble (or no action) — the only thing the agent does", () => {
    expect(priorAuthHasClinicianApproval()).toBe(true);
    expect(priorAuthHasClinicianApproval(null)).toBe(true);
    expect(priorAuthHasClinicianApproval({ kind: "assemble" })).toBe(true);
  });

  it("is false for an autonomous submit (no clinician approval)", () => {
    expect(priorAuthHasClinicianApproval({ kind: "submit" })).toBe(false);
    expect(
      priorAuthHasClinicianApproval({ kind: "submit", clinicianApproved: false })
    ).toBe(false);
  });

  it("is true for a clinician-approved submit", () => {
    expect(
      priorAuthHasClinicianApproval({ kind: "submit", clinicianApproved: true })
    ).toBe(true);
  });
});

describe("priorAuthDocumentationComplete · documentation-integrity signal", () => {
  const completePkg = assemblePriorAuth(baseHrtRequest());
  const incompletePkg = assemblePriorAuth(
    baseHrtRequest({ attachedDocuments: ["doc.clinical-notes"] })
  );

  it("is true when not submitting (a draft may carry missing docs)", () => {
    expect(priorAuthDocumentationComplete(incompletePkg)).toBe(true);
    expect(
      priorAuthDocumentationComplete(incompletePkg, { kind: "assemble" })
    ).toBe(true);
  });

  it("is false only for a submit whose package is missing documentation", () => {
    expect(
      priorAuthDocumentationComplete(incompletePkg, { kind: "submit" })
    ).toBe(false);
    expect(
      priorAuthDocumentationComplete(completePkg, { kind: "submit" })
    ).toBe(true);
  });
});

describe("submitPriorAuth · defense-in-depth refusals", () => {
  it("refuses a submit without clinician approval", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    expect(() => submitPriorAuth(pkg, { kind: "submit" })).toThrow(
      /without clinician approval/i
    );
  });

  it("refuses a submit missing required documentation even with approval", () => {
    const pkg = assemblePriorAuth(
      baseHrtRequest({ attachedDocuments: ["doc.clinical-notes"] })
    );
    expect(() =>
      submitPriorAuth(pkg, { kind: "submit", clinicianApproved: true })
    ).toThrow(/missing required supporting documentation/i);
  });

  it("submits a complete, clinician-approved package", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    const submitted = submitPriorAuth(pkg, {
      kind: "submit",
      clinicianApproved: true
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.submitted).toBe(true);
  });
});

describe("priorAuthSummary · trace-safe roll-up", () => {
  it("summarizes the package counts + status", () => {
    const pkg = assemblePriorAuth(baseHrtRequest());
    const summary = priorAuthSummary(pkg);
    expect(summary.itemId).toBe("pa.systemic-hrt");
    expect(summary.criteriaTotal).toBe(pkg.criteria.length);
    expect(summary.criteriaMet).toBe(pkg.criteria.length);
    expect(summary.documentationComplete).toBe(true);
    expect(summary.status).toBe("ready-for-clinician");
    expect(summary.submitted).toBe(false);
    expect(summary.synthetic).toBe(true);
  });
});
