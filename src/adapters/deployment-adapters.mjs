// Intentionally unconfigured. This is an integration contract, not login support.
// authenticate must cryptographically verify issuer/signature, expiry and audience
// at a trusted ingress. Never trust a caller-supplied identity header.
// Return {verified:true,ownerId,audience,expiresAt} only after that validation.
export async function authenticate(_request,_env){return null;}
// Server-side, revocable site grant: {active:true,ownerId,audience,boardAccess:true,
// projectIds:[...]}. A valid login alone does not grant access to this board.
export async function grantsFor(_ownerId,_env){return null;}
