import {McpEventsError,validateCallbackUrl} from '../domain/mcp-events.mjs';
// Only constructed by the Worker entry. A JS label is not runtime attestation.
// Deployment must verify the compatibility flag and absence of origin/private bindings.
export function createPlatformPublicTransport() {
  return Object.freeze({
    kind:'platform-managed-public-https-v1',
    async sendPublicHttps(q) {
      const url=new URL(validateCallbackUrl(q.url));
      if(q.hostname!==url.hostname||q.method!=='POST'||q.redirect!=='error'||Object.hasOwn(q,'address'))throw new McpEventsError('unsafe_callback_destination',502,-32015);
      if(typeof q.body!=='string'||new TextEncoder().encode(q.body).length>262144)throw new McpEventsError('invalid_callback_payload',502,-32015);
      // Reconstruct every option: callers cannot supply cf.resolveOverride, Host,
      // redirect overrides, a private Fetcher binding, or another transport setting.
      const headers=new Headers();
      for(const key of ['content-type','webhook-id','webhook-timestamp','webhook-signature','x-mcp-subscription-id']) {
        const value=new Headers(q.headers).get(key);if(value!==null)headers.set(key,value);
      }
      return globalThis.fetch(url.href,{method:'POST',headers,body:q.body,redirect:'error',signal:q.signal});
    }
  });
}
