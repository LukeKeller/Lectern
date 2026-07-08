import type { DiscoveryConfig } from "@lectern/shared";
import type { Fetcher } from "./types";
import { searxng } from "./searxng";
import { brave } from "./brave";
import { crawler } from "./crawler";

/** Every registered fetcher, in query order. */
export const allFetchers: Fetcher[] = [searxng, brave, crawler];

/** The subset of fetchers switched on (and configured) for this run. */
export function enabledFetchers(cfg: DiscoveryConfig): Fetcher[] {
  return allFetchers.filter((f) => f.enabled(cfg));
}

export {
  type Fetcher,
  type FetchContext,
  type RawCandidate,
  type FetcherDeps,
  DiscoveryHttpError,
} from "./types";
export { createSearxngFetcher, searxng } from "./searxng";
export { createBraveFetcher, brave } from "./brave";
export { createCrawlerFetcher, crawler } from "./crawler";
