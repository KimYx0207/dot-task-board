import {realpathSync,lstatSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,dirname,basename,join} from 'node:path';
export function canonicalPath(value){
 if(typeof value!=='string'||!value)throw Error('A nonempty filesystem path is required');
 let parent=resolve(value),tail=[];
 while(true){try{return join(realpathSync(parent),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const next=dirname(parent);if(next===parent)throw error;tail.push(basename(parent));parent=next;}}
}
export function pathInside(root,path){const rel=relative(root,path);return rel===''||rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);}
export function noSymlinkPath(root,path){
 if(!pathInside(root,path))throw Error('Path escapes installation directory');
 const parts=relative(root,path).split(sep).filter(Boolean);let current=root;
 for(const part of parts){current=join(current,part);try{if(lstatSync(current).isSymbolicLink())throw Error('Installation paths must not be symlinks');}catch(error){if(error.code!=='ENOENT')throw error;}}
 return path;
}
