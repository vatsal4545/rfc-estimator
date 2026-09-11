// The proposal form's prefill rules.
//
// Two things worth pinning. The mapping from 1 · Project to the proposal's
// tokens, because the whole point is not retyping details that are already in
// the intake. And the precedence, because it decides whose client name ends up
// on a customer-facing document — getting that wrong would relabel an imported
// workbook's proposal with whatever project happened to be open.

import { describe, expect, it } from "vitest";
import { defaultProject } from "../../calc/defaults";
import { defaultIntake } from "../../proposal/defaults";
import type { Project } from "../../calc/types";
import type { OperatorInputSpec } from "../runtime";
import { coerce, initialValue, labelFor, projectPrefills, widgetFor } from "../form";

/** A project with 1 · Project filled in the way a user would. */
function filledProject(): Project {
  const base = defaultProject();
  return {
    ...base,
    setup: {
      ...base.setup,
      clientName: "Hoopa Motel",
      siteAddress: "100 Main St, Hoopa, CA 95546",
      cpm: "R. Mendez",
    },
    intake: {
      ...defaultIntake(),
      contactName: "Dana Okafor",
      contactTitle: "General Manager",
      siteName: "Hoopa Motel & RV",
      propertyType: "Hospitality",
      proposalDate: "2026-09-01",
      validityDays: 45,
      completedBy: "S. Mathew",
    },
  };
}

const spec = (token: string, extra: Partial<OperatorInputSpec> = {}): OperatorInputSpec => ({
  token,
  ...extra,
});

describe("projectPrefills", () => {
  it("carries the client and contact across from 1 · Project", () => {
    const prefills = projectPrefills(filledProject());
    expect(prefills).toMatchObject({
      client_contact_name: "Dana Okafor",
      client_title: "General Manager",
      site_name: "Hoopa Motel & RV",
      site_address: "100 Main St, Hoopa, CA 95546",
      property_type: "Hospitality",
      proposal_date: "2026-09-01",
      validity_days: "45",
      prepared_by_name: "S. Mathew",
    });
  });

  it("falls back to the client when no separate site name was given", () => {
    const project = filledProject();
    project.intake = { ...project.intake!, siteName: "" };
    expect(projectPrefills(project).site_name).toBe("Hoopa Motel");
  });

  it("falls back to the project's CPM for the preparer", () => {
    const project = filledProject();
    project.intake = { ...project.intake!, completedBy: "" };
    expect(projectPrefills(project).prepared_by_name).toBe("R. Mendez");
  });

  it("omits anything nobody filled in, rather than sending a blank", () => {
    // A blank has to be absent, not "", or it would beat the declared default
    // and print an empty field where the agent would have printed "Owner".
    const base = defaultProject();
    const prefills = projectPrefills({ ...base, intake: undefined });
    expect(prefills.client_contact_name).toBeUndefined();
    expect(prefills.client_title).toBeUndefined();
    expect("property_type" in prefills).toBe(false);
  });

  it("survives a project saved before the intake section existed", () => {
    const base = defaultProject();
    expect(() => projectPrefills({ ...base, intake: undefined })).not.toThrow();
  });
});

describe("initialValue precedence", () => {
  const fromProject = projectPrefills(filledProject());

  it("uses 1 · Project when the workbook says nothing", () => {
    // The estimator's own export leaves INPUT SHEET N17:N21 empty, so this is
    // the "use the current estimator settings" case.
    expect(initialValue(spec("client_contact_name"), {}, fromProject)).toBe("Dana Okafor");
    expect(initialValue(spec("site_address"), {}, fromProject)).toBe("100 Main St, Hoopa, CA 95546");
  });

  it("lets an imported workbook's own client info win", () => {
    // Importing someone else's workbook must not relabel it with whatever
    // project is open in the estimator.
    const raw = { site_name: "Food4Less Stockton", client_contact_name: "Other Person" };
    expect(initialValue(spec("site_name"), raw, fromProject)).toBe("Food4Less Stockton");
    expect(initialValue(spec("client_contact_name"), raw, fromProject)).toBe("Other Person");
  });

  it("treats a blank workbook value as absent", () => {
    expect(initialValue(spec("site_name"), { site_name: "" }, fromProject)).toBe("Hoopa Motel & RV");
    expect(initialValue(spec("site_name"), { site_name: null }, fromProject)).toBe("Hoopa Motel & RV");
  });

  it("falls through to the declared default last", () => {
    expect(initialValue(spec("client_title", { default: "Owner" }), {}, {})).toBe("Owner");
    expect(initialValue(spec("primary_users", { default: "Customers and public use" }), {}, {})).toBe(
      "Customers and public use",
    );
  });

  it("resolves the `today` default to a date the date input accepts", () => {
    expect(initialValue(spec("proposal_date", { default: "today" }), {}, {})).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("shows a fraction as per cent, and takes it back the same way", () => {
    const downtime = spec("downtime_assumption", { default: 0.03, format: "percent0" });
    expect(initialValue(downtime, {}, {})).toBe("3");
    expect(coerce(downtime, "3")).toBeCloseTo(0.03, 12);
  });

  it("has no prefill for the fields only a human can answer", () => {
    // site_location_narrative is two to four sentences about the location;
    // nothing in the project or the workbook can supply it.
    expect(initialValue(spec("site_location_narrative"), {}, fromProject)).toBe("");
  });
});

describe("widget and label inference", () => {
  it("picks the widget from the token and the format", () => {
    expect(widgetFor(spec("proposal_date", { default: "today" }))).toBe("date");
    expect(widgetFor(spec("site_location_narrative"))).toBe("textarea");
    expect(widgetFor(spec("downtime_assumption", { default: 0.03, format: "percent0" }))).toBe("percent");
    expect(widgetFor(spec("existing_nameplate_l2_kw", { default: 7.2 }))).toBe("number");
    expect(widgetFor(spec("validity_days", { default: 30 }))).toBe("integer");
    expect(widgetFor(spec("existing_ports_l3"))).toBe("integer");
    expect(widgetFor(spec("client_contact_name"))).toBe("text");
  });

  it("prefers field_map's own prompt, and makes the token readable otherwise", () => {
    expect(labelFor(spec("client_contact_name", { prompt: "Client contact full name" }))).toBe(
      "Client contact full name",
    );
    expect(labelFor(spec("existing_nameplate_l2_kw"))).toBe("Existing nameplate L2 kW");
    expect(labelFor(spec("property_type"))).toBe("Property type");
  });
});

describe("coerce", () => {
  it("drops an empty box so the placeholder is left blank", () => {
    expect(coerce(spec("client_contact_name"), "")).toBeUndefined();
    expect(coerce(spec("client_contact_name"), "   ")).toBeUndefined();
  });

  it("returns numbers as numbers", () => {
    expect(coerce(spec("validity_days", { default: 30 }), "45")).toBe(45);
    expect(coerce(spec("existing_nameplate_l2_kw", { default: 7.2 }), "7.2")).toBe(7.2);
  });

  it("drops nonsense rather than sending NaN into the document", () => {
    expect(coerce(spec("validity_days", { default: 30 }), "abc")).toBeUndefined();
  });
});
