import Config from "../config/config.js";

/**
 * Same shape as caio-server-auth/helpers/providers.js#isConfigured -- the module reads its own
 * required env presence rather than the app deciding for it, so `BinaryStore.createApi()` is
 * only ever wired up when it can actually work.
 */
export function isConfigured() {
  return typeof Config.bucketName === "string" && Config.bucketName.length > 0;
}
