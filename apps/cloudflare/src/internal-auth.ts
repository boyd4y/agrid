/** Portable transport authentication is owned by the execution capability, not the deployment entry. */
export {
  InternalAuthenticationError, signInternalRequest, verifyInternalRequest,
  type InternalAuthenticationOptions, type VerifiedInternalRequest,
} from "@tabdo/execution/internal-auth";
