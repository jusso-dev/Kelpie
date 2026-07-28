export type AttackDomain = "enterprise" | "mobile" | "ics";

/** One technique as parsed from a catalog source (bundled or fetched), before it is stored. */
export type RawAttackTechnique = {
  techniqueId: string;
  name: string;
  domain?: AttackDomain;
  tactics: Array<{ id: string; name: string }>;
  isSubtechnique?: boolean;
  parentTechniqueId?: string | null;
  platforms?: string[];
  dataSources?: string[];
  description?: string | null;
  url?: string | null;
  /** Present only for techniques the source itself marks deprecated/revoked. */
  deprecated?: boolean;
  revoked?: boolean;
  supersededByTechniqueId?: string | null;
  attackVersion?: string | null;
};

export type CatalogSourceInput = {
  version: string;
  techniques: RawAttackTechnique[];
};
