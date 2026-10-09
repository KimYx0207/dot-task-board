const entry=document.getElementById('wechat-entry');
const name=document.getElementById('wechat-name');
const copy=document.getElementById('copy-wechat');
const status=document.getElementById('wechat-copy-status');

if(entry&&name&&copy&&status){
  copy.addEventListener('click',async()=>{
    try{
      if(!navigator.clipboard?.writeText)throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(name.value);
      status.textContent='已复制：老金带你玩AI';
    }catch{
      name.focus();name.select();
      status.textContent='名称已选中，可长按或按 Ctrl / ⌘ + C 复制';
    }
  });
  entry.addEventListener('keydown',event=>{
    if(event.key==='Escape'){entry.open=false;entry.querySelector('summary').focus();}
  });
  document.addEventListener('click',event=>{
    if(entry.open&&!entry.contains(event.target))entry.open=false;
  });
}
