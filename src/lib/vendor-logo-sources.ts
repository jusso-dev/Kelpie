const ICONIFY_OVERRIDES: Record<string, string | null> = {
  azure: "logos:microsoft-azure",
  gcp: "logos:google-cloud",
  "new-relic": "logos:new-relic",
  "help-scout": "simple-icons:helpscout",
  "google-analytics": "logos:google-analytics",
  "github-actions": "logos:github-actions",
  "sauce-labs": "simple-icons:saucelabs",
  "octopus-deploy": "logos:octopus-deploy",
  "alibaba-cloud": "simple-icons:alibabacloud",
  "red-hat": "logos:redhat",
  "wp-engine": "logos:wpengine",
  "cockroach-labs": "simple-icons:cockroachlabs",
  "palo-alto-networks": "simple-icons:paloaltonetworks",
  "trend-micro": "simple-icons:trendmicro",
  "elastic-cloud": "simple-icons:elasticcloud",
  "sumo-logic": "simple-icons:sumologic",
  "better-stack": "simple-icons:betterstack",
  "campaign-monitor": "simple-icons:campaignmonitor",
  "github-copilot": "logos:github-copilot",
  "mistral-ai": "logos:mistral-ai",
  rails: "logos:rails",
  phoenix: "simple-icons:phoenixframework",
  tomcat: "simple-icons:apachetomcat",
  envoy: "simple-icons:envoyproxy",
  postgres: "logos:postgresql",
  plausible: "simple-icons:plausibleanalytics",
  huggingface: "logos:hugging-face",
  "power-bi": "logos:microsoft-power-bi",
  "microsoft-365": null,
};

const LOGO_WEBSITE_OVERRIDES: Record<string, string> = {
  "microsoft-365": "https://www.office.com",
};

function iconifyUrl(identifier: string): string | null {
  const separator = identifier.indexOf(":");
  if (separator === -1) return null;
  const prefix = identifier.slice(0, separator);
  const icon = identifier.slice(separator + 1);
  if (!prefix || !icon) return null;
  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg`;
}

function hostname(website: string): string | null {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function buildVendorLogoSources({
  slug,
  website,
  logoDevToken,
}: {
  slug: string;
  website: string;
  logoDevToken?: string | null;
}): string[] {
  const sources: string[] = [];
  const add = (source: string | null | undefined) => {
    if (source && !sources.includes(source)) sources.push(source);
  };

  const override = ICONIFY_OVERRIDES[slug];
  if (override) add(iconifyUrl(override));
  if (override !== null) {
    add(iconifyUrl(`logos:${slug}`));
    add(iconifyUrl(`simple-icons:${slug.replace(/[^a-z0-9]/g, "")}`));
  }

  const logoWebsite = LOGO_WEBSITE_OVERRIDES[slug] ?? website;
  const host = hostname(logoWebsite);
  if (!host) return sources;

  const token = logoDevToken?.trim();
  if (token) {
    add(
      `https://img.logo.dev/${encodeURIComponent(host)}?token=${encodeURIComponent(token)}&size=128&format=png`,
    );
  }
  add(
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(logoWebsite)}&sz=128`,
  );
  add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
  add(`https://icon.horse/icon/${encodeURIComponent(host)}`);

  return sources;
}
