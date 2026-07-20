import { buildApp } from "./app";
import { config } from "./config";
import { startJobs, stopJobs } from "./jobs";

const app = buildApp();

const jobsEnabled =
  process.env.LECTERN_ENABLE_JOBS === "1" || process.env.LECTERN_ENABLE_JOBS === "true";

/**
 * Last-resort backstop for faults that no `await` can catch.
 *
 * This exists because of a real outage: an IMAP client emitted `'error'` with no
 * listener, which throws outside every promise chain, and the whole BFF — API,
 * reader, feeds — exited and systemd restart-looped it. That specific bug is
 * fixed at its source, but the class is structural. EventEmitters and timer
 * callbacks (pg-boss's maintenance and cron timers, a `pg` pool re-emitting an
 * idle-client error) can raise faults nothing is awaiting, and one background
 * job must never be able to take down the process serving everything else.
 *
 * DELIBERATELY ASYMMETRIC, because the two signals mean different things:
 *
 *  - `unhandledRejection` — a dropped promise. The process state is intact; some
 *    piece of async work failed with nobody listening. Log it and keep serving.
 *    Node's default here is to crash, which is exactly the behaviour that turned
 *    "newsletter fetch failed" into "Lectern is down".
 *
 *  - `uncaughtException` — an exception unwound the stack to the event loop.
 *    Whatever was mid-flight is now in an unknown state, so continuing is a
 *    genuine gamble. We still do NOT exit immediately: staying up degraded beats
 *    a restart loop, and every fault we have actually seen originated in an
 *    isolated background job rather than in request handling. But it is logged
 *    as `fatal` so it is greppable and never mistaken for routine noise.
 *
 * This is a safety net, NOT a licence to leave promises unhandled. Anything that
 * lands here is a bug to fix at its source — the log line says so, because a
 * silent backstop is how you end up with an app that is quietly broken instead
 * of loudly restarting.
 */
function describeFault(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
    return `${err.name}: ${err.message}${cause}\n${err.stack ?? ""}`;
  }
  return String(err);
}

process.on("unhandledRejection", (reason) => {
  console.error(`[unhandledRejection] ${describeFault(reason)}`);
});

process.on("uncaughtException", (err) => {
  console.error(`[uncaughtException] fatal, staying up degraded: ${describeFault(err)}`);
});

app
  .listen({ port: config.BFF_PORT, host: config.BFF_HOST })
  .then(async (address) => {
    console.log(`Lectern BFF listening on ${address}`);
    if (jobsEnabled) {
      await startJobs();
      console.log("Lectern background jobs started");
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * Shutdown must terminate even when it fails. A rejection inside the old
 * un-`catch`ed `void (async () => …)()` skipped `process.exit`, so systemd would
 * wait out its full stop timeout and SIGKILL instead. Exit 1 on a failed
 * shutdown; guard against a second signal re-entering mid-teardown.
 */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        if (jobsEnabled) await stopJobs();
        await app.close();
        process.exit(0);
      } catch (err) {
        console.error(`[shutdown] failed: ${describeFault(err)}`);
        process.exit(1);
      }
    })();
  });
}
