// Apply the saved/device theme before the map stylesheet paints.
(() => {
  const key='bay-in-motion-theme',system=matchMedia('(prefers-color-scheme: dark)');
  const valid=value=>value==='night'||value==='day';
  let preference=null;
  try { const saved=localStorage.getItem(key);if(valid(saved))preference=saved; } catch {}
  function apply(){
    const night=preference?preference==='night':system.matches;
    document.documentElement.dataset.theme=night?'night':'day';
    document.documentElement.style.colorScheme=night?'dark':'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',night?'#14191f':'#faf9f6');
    const button=document.getElementById('theme');
    if(button){button.setAttribute('aria-pressed',String(night));button.setAttribute('aria-label',night?'Switch to day mode':'Switch to night mode');button.title=night?'Day mode (N)':'Night mode (N)';}
  }
  function toggle(){
    preference=document.documentElement.dataset.theme==='night'?'day':'night';
    try { localStorage.setItem(key,preference); } catch {}
    apply();
  }
  apply();
  function connect(){document.getElementById('theme')?.addEventListener('click',toggle);apply();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',connect,{once:true});else connect();
  system.addEventListener?.('change',()=>{if(!preference)apply();});
  window.addEventListener('storage',event=>{if(event.key===key){preference=valid(event.newValue)?event.newValue:null;apply();}});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.key.toLowerCase()!=='n'||event.target.closest?.('select,input,textarea,[contenteditable]'))return;
    event.preventDefault();toggle();
  });
})();
