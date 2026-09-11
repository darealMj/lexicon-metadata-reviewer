let savedModels = [];
let savedTimeout = 120;
const $ = id => document.getElementById(id);
const status = message => $('status').textContent = message;
async function api(path, body) {
  const response = await fetch('/metadata/' + path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const pct = value => typeof value === 'number' ? (100*value).toFixed(1)+'%' : '—';
function modelPerformance(run) {
  const models=run.models || [run.model];
  return models.map(model=>{
    const rows=run.results.filter(r=>(r.model || run.model)===model);
    const find=c=>rows.find(r=>r.id===c.id);
    const average=(cases,metric)=>cases.length ? cases.reduce((sum,c)=>sum+(find(c)?.error ? 0 : Number(find(c)?.[metric] || 0)),0)/cases.length : null;
    const scored=run.cases.filter(c=>c.expected_tags!==null || 'expected_albums' in c || 'expected_year' in c);
    const overall=scored.length ? scored.reduce((sum,c)=>{
      const r=find(c);if(!r || r.error)return sum;
      const scores=[];if(c.expected_tags!==null)scores.push(r.f1 || 0);
      if('expected_albums' in c)scores.push(Number(r.album_correct || false));
      if('expected_year' in c)scores.push(Number(r.year_correct || false));
      return sum+scores.reduce((a,b)=>a+b,0)/scores.length;
    },0)/scored.length : null;
    const costs=rows.map(r=>r.usage?.cost);
    const known=costs.length>0 && costs.every(c=>typeof c==='number' && Number.isFinite(c) && c>=0);
    return {model,overall,tags:average(run.cases.filter(c=>c.expected_tags!==null),'f1'),
      album:average(run.cases.filter(c=>'expected_albums' in c),'album_correct'),year:average(run.cases.filter(c=>'expected_year' in c),'year_correct'),
      succeeded:rows.filter(r=>!r.error).length,failed:rows.filter(r=>r.error).length,skipped:run.cases.length-rows.length,
      seconds:rows.length ? rows.reduce((sum,r)=>sum+(r.seconds || 0),0)/rows.length : null,cost:known?costs.reduce((a,b)=>a+b,0):null};
  }).sort((a,b)=>(b.overall ?? -1)-(a.overall ?? -1));
}
function performanceSummary(run) {
  const card=document.createElement('div');card.className='performance-summary';
  const title=document.createElement('h3');title.textContent='Model performance';card.append(title);
  const scroll=document.createElement('div');scroll.className='scroll';const table=document.createElement('table');
  const head=document.createElement('tr');for(const label of ['Rank / model','Overall','Tag F1','Album','Year','Succeeded','Failed / skipped','Avg request','Reported cost']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
  let previous=null,rank=0;
  modelPerformance(run).forEach((m,i)=>{
    if(i===0 || m.overall!==previous)rank=i+1;previous=m.overall;
    const tr=document.createElement('tr');if(rank===1 && m.overall!==null)tr.className='performance-best';
    for(const value of [`${m.overall===null?'—':rank+'.'} ${m.model}`,pct(m.overall),pct(m.tags),pct(m.album),pct(m.year),`${m.succeeded}/${run.cases.length}`,`${m.failed} / ${m.skipped}`,m.seconds===null?'—':m.seconds.toFixed(2)+'s',m.cost===null?'Unavailable':'$'+m.cost.toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);
  });
  scroll.append(table);card.append(scroll);
  const note=document.createElement('p');note.className='muted';note.textContent='Overall averages the available tag F1, album and year checks per track. Failed or skipped tracks score zero. All models use this run’s reference data; this is agreement with your labels, not verified accuracy. Average time includes failures. Missing cost is unavailable, not free. Router rows represent the requested router, which may use different models.';card.append(note);
  return card;
}
function render(runs) {
  $('runs').replaceChildren();
  if (!runs.length) { $('runs').textContent='No evaluations yet.'; return; }
  for (const run of runs) {
    const details=document.createElement('details'), summary=document.createElement('summary');
    summary.textContent=`${new Date(run.created_at*1000).toLocaleString()} · ${run.model} · F1 ${pct(run.summary.macro_f1)} · ${run.results.length}/${run.summary.total} attempted · ${run.summary.completed} succeeded · ${run.results.filter(r=>r.error).length} failed`;
    details.append(summary);
    details.open=run===runs[0];
    details.append(performanceSummary(run));
    if(run.tournament){
      const title=document.createElement('p');title.textContent=`Random benchmark · Provisional winner: ${run.tournament.provisional_winner}. ${run.tournament.selection_note}`;details.append(title);

    }
    const meta=document.createElement('p'); meta.className='muted'; meta.textContent=`Dataset ${run.dataset_hash} · ${run.prompt_version} · Token limit ${run.max_tokens ?? 700} · Timeout ${run.timeout_seconds ?? 45}s · Web ${run.web_search ? 'on' : 'off'} · Scoring ${run.scoring_version || 'legacy'}`; details.append(meta);
    const trackDetails=document.createElement('details');const trackTitle=document.createElement('summary');trackTitle.textContent='Track details, sources and errors';trackDetails.append(trackTitle);details.append(trackDetails);
    if (run.models?.length > 1) {

      const comparison=document.createElement('div');comparison.className='scroll';const grid=document.createElement('table');
      const header=document.createElement('tr');for(const name of ['Track',...run.models,'Agreement']){const th=document.createElement('th');th.textContent=name;header.append(th);}grid.append(header);
      for(const test of run.cases){
        const tr=document.createElement('tr'), title=document.createElement('td');title.textContent=`${test.artist} — ${test.title}`;tr.append(title);
        const rows=run.models.map(model=>run.results.find(r=>r.id===test.id && r.model===model));
        for(const row of rows){const td=document.createElement('td');td.textContent=!row ? 'Not attempted' : row.error || `${(row.tags||[]).map(t=>t.label).join(', ') || 'Abstained'} | ${row.album || '—'} / ${row.year ?? '—'} | F1 ${pct(row.f1)}`;tr.append(td);}
        const votes=new Map();for(const row of rows.filter(r=>r && !r.error)){
          const values=new Set((row.tags||[]).map(t=>'Tag: '+t.label.toLowerCase().trim()));
          if(row.album)values.add('Album: '+row.album.toLowerCase().trim());if(row.year)values.add('Year: '+row.year);
          for(const value of values)votes.set(value,(votes.get(value)||0)+1);
        }
        const agreement=document.createElement('td');agreement.textContent=[...votes].filter(([,n])=>n>=2).map(([v,n])=>`${v} (${n}/${run.models.length})`).join('; ') || 'No shared values';tr.append(agreement);grid.append(tr);
      }
      comparison.append(grid);trackDetails.append(comparison);const note=document.createElement('p');note.className='muted';note.textContent='Agreement compares label text, not truth. Errors do not count as votes. Detailed confidence, sources, and errors appear below.';trackDetails.append(note);
    }
    const scroll=document.createElement('div'); scroll.className='scroll'; const table=document.createElement('table');
    const head=document.createElement('tr'); for(const label of ['Track','Suggested tags / confidence','Error','Album / year','Precision','Recall','F1','Brier','Time','Sources / review']) {const th=document.createElement('th');th.textContent=label;head.append(th);} table.append(head);
    for(const row of run.results) {
      const tr=document.createElement('tr'), test=run.cases.find(c=>c.id===row.id);
      const values=[`${test.artist} — ${test.title} · ${row.model || run.model}`,(row.tags || []).map(t=>`${t.label} (${pct(t.confidence)})`).join(', ') || (row.error ? '—' : 'Abstained'),row.error || '—',`${row.album || '—'}${row.album_correct === undefined ? '' : row.album_correct ? ' ✓' : ' ✗'} / ${row.year ?? '—'}${row.year_correct === undefined ? '' : row.year_correct ? ' ✓' : ' ✗'}`,pct(row.precision),pct(row.recall),pct(row.f1),row.brier?.toFixed(3) ?? '—',`${row.seconds}s`];
      for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}const sourceCell=document.createElement('td');
      if(row.resolved_model){const model=document.createElement('p');model.textContent='Used: '+row.resolved_model;sourceCell.append(model);}
      const cost=row.usage?.cost;if(typeof cost==='number' && Number.isFinite(cost) && cost>=0){const pill=document.createElement('span');pill.className='ai-price-pill';pill.textContent='Reported lookup: $'+cost.toFixed(6);sourceCell.append(pill);}
      for(const source of row.sources || []) {
        try { const url=new URL(source.url); if(!['http:','https:'].includes(url.protocol))continue;
          const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${source.title} (${source.origin})`;sourceCell.append(a,document.createElement('br'));
        } catch {}
      }
      const note=document.createElement('p');note.textContent=[row.source_warning, ...(row.conflicts || []).map(c=>'Source conflict: '+c), row.unreviewed_tags?.length ? `Unreviewed extras: ${row.unreviewed_tags.join(', ')}` : ''].filter(Boolean).join(' ');sourceCell.append(note);tr.append(sourceCell);table.append(tr);
    }
    scroll.append(table);trackDetails.append(scroll);
    const button=document.createElement('button');button.textContent='Export run (includes usage and resolved model)';button.className='secondary';button.onclick=()=>download(`ai-run-${run.id}.json`,run);details.append(button);
    $('runs').append(details);
  }
}
async function load(){const data=await api('ai');$('base').value=data.base_url;$('model').value=data.model;$('model2').value=data.model_2;$('model3').value=data.model_3;savedModels=[...new Set([data.model,data.model_2,data.model_3].map(m=>(m||'').trim()).filter(Boolean))];$('tokens').value=data.max_tokens;$('timeout').value=data.timeout_seconds;savedTimeout=data.timeout_seconds;$('web').checked=data.web_search;$('wikipedia').checked=data.wikipedia;$('jsonMode').checked=data.json_mode;$('key').placeholder=data.key_configured?'•••••••• (saved)':'Enter API key';render(data.runs);window.dispatchEvent(new Event('ai-settings-loaded'));}
async function starter(){const r=await fetch('/evals/tag-benchmark.json');if(!r.ok)throw new Error('Could not load starter dataset');$('dataset').value=JSON.stringify(await r.json(),null,2);}
$('settings').onsubmit=async e=>{e.preventDefault();if(!confirm('Update AI settings?'))return;try{const body={ai_base_url:$('base').value.trim(),ai_model:$('model').value.trim(),ai_model_2:$('model2').value.trim(),ai_model_3:$('model3').value.trim(),ai_max_tokens:Number($('tokens').value),ai_timeout_seconds:Number($('timeout').value),ai_web_search:$('web').checked,ai_wikipedia:$('wikipedia').checked,ai_json_mode:$('jsonMode').checked};if($('key').value)body.ai_api_key=$('key').value;await api('ai/config',body);$('key').value='';await load();status('Settings saved.');}catch(e){status(e.message);}};
$('starter').onclick=()=>{if(confirm('Replace the dataset in the editor?'))starter().catch(e=>status(e.message));};
$('import').onchange=async()=>{try{const f=$('import').files[0];if(!f)return;if(f.size>65536)throw new Error('Dataset must be under 64 KB');$('dataset').value=JSON.stringify(JSON.parse(await f.text()),null,2);}catch(e){status(e.message);}};
$('export').onclick=()=>{try{download('tag-benchmark.json',JSON.parse($('dataset').value));}catch(e){status(e.message);}};
$('run').onclick=async()=>{try{const cases=JSON.parse($('dataset').value);if(!Array.isArray(cases)||!cases.length||cases.length>50)throw new Error('Use 1–50 test tracks.');if(!savedModels.length)throw new Error('Save at least one model first.');if(!confirm(`Make ${cases.length*savedModels.length} requests: ${cases.length} tracks × ${savedModels.length} models to the saved AI endpoint? Model and web-search charges may apply with the saved settings.`))return;$('run').disabled=true;$('settings').querySelector('button').disabled=true;status(`Running ${cases.length*savedModels.length} requests… Keep this page open (${savedTimeout}-second request timeout; no retries).`);const result=await api('ai/run',cases);await load();status(`Saved: ${result.summary.attempted}/${result.summary.total} attempted, ${result.summary.completed} succeeded, ${result.summary.failed} failed. F1 ${pct(result.summary.macro_f1)}.`);}catch(e){status(e.message);}finally{$('run').disabled=false;$('settings').querySelector('button').disabled=false;}};
Promise.all([load(),starter(),api('config').then(c=>document.documentElement.dataset.theme=c.theme)]).catch(e=>status(e.message));

let randomPlan=null;
$('previewModels').onclick=async()=>{try{$('previewModels').disabled=true;randomPlan=null;$('runRandom').disabled=true;status('Loading current model catalog…');
  const plan=await api('ai/preview',{cases:JSON.parse($('dataset').value),count:Number($('randomCount').value),price:Number($('randomPrice').value),budget:Number($('randomBudget').value),reviewed:$('reviewed').checked});
  randomPlan=plan;$('randomPreview').textContent=plan.models.map(m=>`${m.id}: $${m.input_per_million.toFixed(3)} input / $${m.output_per_million.toFixed(3)} output per million tokens`).join('\n')+`\n${plan.requests} requests · ${plan.eligible_count} eligible models · Key credit cap $${plan.budget} · Web search ${plan.web_search?'on':'off'}\nPreview expires in 15 minutes. Dataset/settings are captured at preview time.`;$('runRandom').disabled=false;status('Preview ready.');
}catch(e){status(e.message);}finally{$('previewModels').disabled=false;}};
$('runRandom').onclick=async()=>{if(!randomPlan)return;const plan=randomPlan;if(!confirm(`Run ${plan.requests} requests using ${plan.models.map(m=>m.id).join(', ')}? Model/search charges apply, bounded by your configured OpenRouter key credit limit (maximum $${plan.budget}).`))return;
  try{for(const id of ['runRandom','previewModels','run'])$(id).disabled=true;status('Running random benchmark… Keep this page open.');
    const result=await api('ai/tournament',{id:plan.id});randomPlan=null;await load();status(result.tournament.selection_note);
  }catch(e){status(e.message);}finally{for(const id of ['previewModels','run'])$(id).disabled=false;$('runRandom').disabled=!randomPlan;}
};
