import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  // Bundle workspace packages (they ship TypeScript source via their exports).
  noExternal: [/^@lectern\//],
});
