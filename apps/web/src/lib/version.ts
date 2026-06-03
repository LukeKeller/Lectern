/**
 * Deploy version, baked into the bundle at build time (see vite.config.ts
 * `define`). build-artifact.sh sets LECTERN_VERSION from the YunoHost manifest;
 * dev builds report "dev". Because it's compiled in, the value shown in the UI
 * is exactly the version of the running build.
 */
export const APP_VERSION: string = __LECTERN_VERSION__;
