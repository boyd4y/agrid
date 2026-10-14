/** Compatibility entry; authentication is portable, without loading a platform runtime. */
export {
  InternalAuthenticationError, signInternalRequest, verifyInternalRequest,
  type InternalAuthenticationOptions, type VerifiedInternalRequest,
} from "@tabdo/platform-cloudflare/internal-auth";
