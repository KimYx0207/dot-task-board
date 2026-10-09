// Read-only first-install identity lookup. Only deploy behind Sites' verified
// authenticated-user header injection. A signed-in user is NOT proof of ownership.
// The installing dot must check owner-private access in the Sites management plane.
const sitesSetupHeaders={
 'Cache-Control':'private, no-store, max-age=0',
 Pragma:'no-cache',
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
 Vary:'oai-authenticated-user-id'
};
function sitesSetupJson(value,status=200,extra={}){return Response.json(value,{status,headers:{...sitesSetupHeaders,...extra}});}
function sitesSetupEscape(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
export function sitesIdentitySetupResponse(request,env={}){
 if(env.DOT_BOARD_IDENTITY_SETUP_ENABLED!=='true')return sitesSetupJson({error:'identity_setup_disabled'},404);
 if(env.DOT_BOARD_INGRESS!=='sites-owner-private-v1'||typeof env.DOT_BOARD_AUDIENCE!=='string')return sitesSetupJson({error:'identity_setup_unconfigured'},503);
 let audience,url;
 try{audience=new URL(env.DOT_BOARD_AUDIENCE);url=new URL(request.url);}catch{return sitesSetupJson({error:'identity_setup_unconfigured'},503);}
 if(audience.protocol!=='https:'||audience.origin!==env.DOT_BOARD_AUDIENCE||audience.username||audience.password)return sitesSetupJson({error:'identity_setup_unconfigured'},503);
 if(url.origin!==audience.origin)return sitesSetupJson({error:'audience_rejected'},403);
 if(!['/setup','/api/setup/identity'].includes(url.pathname))return sitesSetupJson({error:'not_found'},404);
 if(request.headers.has('origin')&&request.headers.get('origin')!==audience.origin)return sitesSetupJson({error:'origin_rejected'},403);
 if(request.method!=='GET')return sitesSetupJson({error:'method_not_allowed'},405,{Allow:'GET'});
 if(url.search)return sitesSetupJson({error:'setup_parameters_not_supported'},400);
 const siteUserId=request.headers.get('oai-authenticated-user-id');
 if(!siteUserId||siteUserId!==siteUserId.trim()||siteUserId.length>512)return sitesSetupJson({error:'authentication_required'},401);
 if(env.DOT_BOARD_OWNER_ID){
  if(siteUserId!==env.DOT_BOARD_OWNER_ID)return sitesSetupJson({error:'board_access_denied'},403);
  return sitesSetupJson({error:'identity_setup_already_complete'},409);
 }
 const value={siteOrigin:audience.origin,siteUserId,identitySource:'sites_authenticated_request',ownerBindingChanged:false,ownershipVerifiedByThisEndpoint:false};
 if(url.pathname==='/api/setup/identity')return sitesSetupJson(value);
 const id=sitesSetupEscape(siteUserId),origin=sitesSetupEscape(audience.origin);
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>完成你的看板安装 · dot task board setup</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1.25rem;color:#17212b;background:#fff}h1{font-size:1.6rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f8;padding:1rem;border-radius:.5rem}small{display:block;color:#536272}</style><main><h1>完成你的看板安装</h1><p>你已经登录这个 Site。这是平台为当前登录账号提供的本站身份。你无需猜测或修改这个值。</p><p>站点 / Site</p><pre>${origin}</pre><p>当前登录身份 / Current signed-in Site identity</p><pre id="site-identity">${id}</pre><p>请把这个身份值交给正在为你安装看板的 dot。它应先核实你是本站所有者、本站仅你可访问，再向你确认这次身份配置；确认后完成配置并关闭安装模式。</p><p><strong>本页只读，不会认领站点、保存所有者或开放看板。</strong>当前登录身份本身不证明站点所有权。不要发送密码或令牌。</p><small>This read-only page does not bind an owner or grant access. Your dot must verify owner-private access in Sites, ask for the actual identity-configuration confirmation, save the binding through supported runtime settings, and deploy the configuration. No password or token is needed here.</small></main></html>`;
 return new Response(html,{headers:{...sitesSetupHeaders,'Content-Type':'text/html; charset=utf-8'}});
}
