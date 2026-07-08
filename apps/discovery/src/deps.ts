import type { RunTrigger } from "@lectern/shared";
import type { AppDeps } from "./app";
import { buildClient } from "./lectern";
import { runDiscovery, type DiscoveryClient } from "./run";
import { allFetchers } from "./fetchers";

/**
 * Wire the real dependency graph: a `LecternClient` factory + the real
 * `runDiscovery` runner over the full fetcher registry. Client construction is
 * connection-lazy, so importing this module performs no I/O.
 */
export function buildRealDeps(): AppDeps {
  return {
    createClient: () => buildClient(),
    runner: (client: DiscoveryClient, opts: { trigger: RunTrigger }) =>
      runDiscovery(client, { trigger: opts.trigger, fetchers: allFetchers }),
  };
}
