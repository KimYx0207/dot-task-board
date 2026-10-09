const encode=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
export function bridgeSecretValid(secret){
 try{return typeof secret==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(secret)&&atob(secret).length===32&&btoa(atob(secret))===secret;}catch{return false;}
}
async function key(secret){
 if(!bridgeSecretValid(secret))throw Error('bridge_unconfigured');
 const bytes=Uint8Array.from(atob(secret),x=>x.charCodeAt(0));if(bytes.length!==32||b64(bytes)!==secret)throw Error('bridge_unconfigured');
 return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
const message=(id,timestamp,audience,body)=>encode.encode('dot-board-events-bridge/1\nPOST\n/bridge\n'+audience+'\n'+id+'\n'+timestamp+'\n'+body);
export async function bridgeHeaders({secret,audience,body,requestId=crypto.randomUUID(),now=Date.now()}){
 const timestamp=String(Math.floor(now/1000));
 const signature=b64(await crypto.subtle.sign('HMAC',await key(secret),message(requestId,timestamp,audience,body)));
 return {'content-type':'application/json','x-board-bridge-id':requestId,'x-board-bridge-time':timestamp,'x-board-bridge-signature':signature};
}
export async function verifyBridge(request,{secret,audience,body,now=Date.now()}){
 const id=request.headers.get('x-board-bridge-id'),timestamp=request.headers.get('x-board-bridge-time'),signature=request.headers.get('x-board-bridge-signature');
 if(!id||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,99}$/.test(id)||!timestamp||!/^\d{10,12}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>60||!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return null;
 try{return await crypto.subtle.verify('HMAC',await key(secret),Uint8Array.from(atob(signature),x=>x.charCodeAt(0)),message(id,timestamp,audience,body))?{id,expiresAt:Math.floor(now/1000)+120}:null;}catch{return null;}
}
