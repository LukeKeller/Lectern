import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../src/api";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
// eslint-disable-next-line no-console
console.log("wrote", out);
