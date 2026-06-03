import { buildApp } from "./app";

const port = Number(process.env.BFF_PORT ?? 8787);
const host = process.env.BFF_HOST ?? "127.0.0.1";

const app = buildApp();

app
  .listen({ port, host })
  .then((address) => {
    console.log(`Lectern BFF listening on ${address}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
