import { permanentRedirect } from "next/navigation";

export default function LegacyThreatLandscapeRedirect() {
  permanentRedirect("/threat-landscape");
}
