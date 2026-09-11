const source=document.getElementById('metadataSource');
const inputs=['model','model2','model3'].map(id=>document.getElementById(id)).filter(Boolean);
let catalog=null, fetched=0, pending=null;
const badges=new Map();
for(const input of source ? [source] : inputs){
  const badge=document.createElement('span');badge.className='ai-price-pill';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');input.insertAdjacentElement('afterend',badge);badges.set(input,badge);
}
const money=n=>'$'+n.toLocaleString('en-US',{maximumFractionDigits:6});
function paint(){
  for(const [input,badge] of badges){
    badge.hidden=!!source && source.value!=='ai';
    const model=source ? catalog?.selected_model : input.value.trim();
    const base=source ? catalog?.base_url : document.getElementById('base').value.trim();
    badge.title='USD per 1 million tokens. Input and output are billed separately. Published catalog rates; provider/context pricing can vary. Search and other fees are additional.';
    if(!model){badge.textContent=catalog?.error?'Pricing unavailable':source&&!catalog?'Loading model pricing…':'No model selected';continue;}
    try{if(new URL(base).hostname!=='openrouter.ai'){badge.textContent='Pricing unavailable for this endpoint';continue;}}catch{badge.textContent='Pricing unavailable';continue;}
    if(/^openrouter\/(auto(?:-beta)?|free|router)(?::|$)/.test(model)){
      badge.textContent=model==='openrouter/free'?'Free router · token rates $0':'Auto router · variable pricing';
      badge.title+=' Routed model is chosen per request. See the result for the actual model and reported request cost when supplied.';continue;
    }
    const p=catalog?.models?.[model];
    badge.textContent=!catalog?'Loading pricing…':!p || p.input===null || p.output===null?'Pricing unavailable':`${money(p.input)} in / ${money(p.output)} out per M`;
    if(catalog?.checked_at)badge.title+=' Checked '+new Date(catalog.checked_at*1000).toLocaleString()+'.';
    if(source)badge.title=model+' — '+badge.title;
  }
}
async function refresh(force=false){
  paint();if(pending)return pending;if(!force && Date.now()-fetched<300000)return;
  pending=(async()=>{try{const r=await fetch('/metadata/ai-pricing');if(!r.ok)throw Error();catalog=await r.json();fetched=Date.now();}catch{catalog={models:{},error:'Pricing unavailable'};}finally{pending=null;paint();}})();return pending;
}
for(const input of inputs)input.addEventListener('input',()=>refresh());
document.getElementById('base')?.addEventListener('input',paint);
source?.addEventListener('change',()=>refresh(true));
window.addEventListener('ai-settings-loaded',()=>refresh(true));
window.addEventListener('focus',()=>refresh(true));
refresh();
