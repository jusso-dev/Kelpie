import { enrichObservableViaRegistry } from "./enrichment/registry";

/**
 * Legacy entry point kept for existing call sites. The real work happens
 * inside the provider registry.
 */
export async function enrichObservable(
  observableId: string,
  _type: string,
  _value: string,
): Promise<void> {
  await enrichObservableViaRegistry(observableId);
}

export { listProviders } from "./enrichment/registry";
