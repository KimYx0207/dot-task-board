import {readBoard} from '../application/board-service.mjs';
export const responseHeaders = {
  'cache-control':'private, no-store, max-age=0',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-robots-tag':'noindex, nofollow, noarchive',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
};
export async function handleRequest(request,{readSnapshot,getAsset,config}) {
  const headers = {...responseHeaders};
  if (!['GET','HEAD'].includes(request.method)) return new Response('Read-only',{status:405,headers:{...headers,allow:'GET, HEAD'}});
  const url = new URL(request.url);
  let response;
  if (url.pathname === '/api/board') {
    const result = await readBoard(readSnapshot,config);
    response = new Response(JSON.stringify(result.body),{status:result.status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
  } else if (url.pathname === '/api/config') {
    response = new Response(JSON.stringify(config),{headers:{...headers,'content-type':'application/json; charset=utf-8'}});
  } else if (url.pathname === '/health') {
    response = new Response('{"status":"ok","mode":"read-only"}',{headers:{...headers,'content-type':'application/json'}});
  } else if (url.pathname === '/preview/mobile') {
    response = new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>dot board · 390px layout check</title><body><p>390px 手机宽度检查 · 同一个真实页面</p><iframe src="/" title="390px task board" width="390" height="844"></iframe></body></html>',{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
  } else {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const allowed = {'/index.html':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/styles.css':'text/css; charset=utf-8'};
    if (!Object.hasOwn(allowed,path)) return new Response('Not found',{status:404,headers});
    const asset = await getAsset(path);
    response = new Response(asset,{headers:{...headers,'content-type':allowed[path]}});
  }
  return request.method === 'HEAD' ? new Response(null,{status:response.status,headers:response.headers}) : response;
}
