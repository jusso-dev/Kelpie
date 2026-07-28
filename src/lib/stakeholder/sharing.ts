/**
 * TLP/PAP + compartment gates for stakeholder sharing (issue #63).
 *
 * Inviter case access alone is not enough: export permission is required,
 * and the invitation ceiling must cover the case classification.
 */

import { authorizeCase, type AccessActor } from "@/lib/access";
import {
  StakeholderError,
  tlpRank,
  papRank,
  type StakeholderPap,
  type StakeholderTlp,
} from "./types";

export type ShareCaseRow = {
  id: string;
  organisationId: string;
  tlp: string;
  pap: string;
  caseNumber: string;
  title: string;
  status: string;
  severity: string;
};

/**
 * Throws StakeholderError when the inviter may not share this case externally
 * at the requested classification ceiling.
 */
export async function assertCanShareCase(opts: {
  caseRow: ShareCaseRow;
  actor: AccessActor;
  maxTlp: StakeholderTlp;
  maxPap: StakeholderPap;
}): Promise<void> {
  if (opts.actor.organisationId !== opts.caseRow.organisationId) {
    throw new StakeholderError("Case not found", 404);
  }

  // Export is the share gate: compartments / restricted visibility deny
  // even when the inviter can view the case. authorizeCase returns the same
  // 404 shape for missing and unauthorized (no existence oracle).
  const decision = await authorizeCase(
    opts.caseRow.organisationId,
    opts.caseRow.id,
    opts.actor,
    "export",
  );
  if (!decision.ok) {
    throw new StakeholderError(
      "Compartment or access policy blocks external sharing for this case",
      403,
    );
  }

  if (tlpRank(opts.caseRow.tlp) > tlpRank(opts.maxTlp)) {
    throw new StakeholderError(
      `Case TLP:${opts.caseRow.tlp} exceeds invitation ceiling TLP:${opts.maxTlp}. Raise the ceiling or lower the case classification before inviting.`,
      403,
    );
  }
  if (papRank(opts.caseRow.pap) > papRank(opts.maxPap)) {
    throw new StakeholderError(
      `Case PAP:${opts.caseRow.pap} exceeds invitation ceiling PAP:${opts.maxPap}. Raise the ceiling or lower the case classification before inviting.`,
      403,
    );
  }
}
