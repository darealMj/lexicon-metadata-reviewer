let savedModels = [];
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
function render(runs) {
  $('runs').replaceChildren();
  if (!runs.length) { $('runs').textContent='No evaluations yet.'; return; }
  for (const run of runs) {
    const details=document.createElement('details'), summary=document.createElement('summary');
    summary.textContent=`${new Date(run.created_at*1000).toLocaleString()} · ${run.model} · F1 ${pct(run.summary.macro_f1)} · ${run.results.length}/${run.summary.total} attempted · ${run.summary.completed} succeeded · ${run.results.filter(r=>r.error).length} failed`;
    details.append(summary);
    if(run.tournament){
      const title=document.createElement('p');title.textContent=`Random benchmark · Provisional winner: ${run.tournament.provisional_winner}. ${run.tournament.selection_note}`;details.append(title);
      for(const entry of run.tournament.leaderboard){const line=document.createElement('p');line.textContent=`${entry.model}: training ${pct(entry.training_score)}, holdout ${pct(entry.holdout_score)}, ${entry.failures} errors, ${entry.seconds.toFixed(1)}s, reported cost ${entry.reported_cost === null ? 'unavailable' : '$'+entry.reported_cost.toFixed(4)}`;details.append(line);}
    }
    const meta=document.createElement('p'); meta.className='muted'; meta.textContent=`Dataset ${run.dataset_hash} · ${run.prompt_version} · Token limit ${run.max_tokens ?? 700} · Web ${run.web_search ? 'on' : 'off'} · Scoring ${run.scoring_version || 'legacy'}`; details.append(meta);
    if (run.models?.length > 1) {
      for(const model of run.model_summaries || []) { const p=document.createElement('p');p.textContent=`${model.model}: F1 ${pct(model.macro_f1)}, ${model.completed} succeeded, ${model.failed} failed`;details.append(p); }
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
      comparison.append(grid);details.append(comparison);const note=document.createElement('p');note.className='muted';note.textContent='Agreement compares label text, not truth. Errors do not count as votes. Detailed confidence, sources, and errors appear below.';details.append(note);
    }
    const scroll=document.createElement('div'); scroll.className='scroll'; const table=document.createElement('table');
    const head=document.createElement('tr'); for(const label of ['Track','Suggested tags / confidence','Error','Album / year','Precision','Recall','F1','Brier','Time','Sources / review']) {const th=document.createElement('th');th.textContent=label;head.append(th);} table.append(head);
    for(const row of run.results) {
      const tr=document.createElement('tr'), test=run.cases.find(c=>c.id===row.id);
      const values=[`${test.artist} — ${test.title} · ${row.model || run.model}`,(row.tags || []).map(t=>`${t.label} (${pct(t.confidence)})`).join(', ') || (row.error ? '—' : 'Abstained'),row.error || '—',`${row.album || '—'}${row.album_correct === undefined ? '' : row.album_correct ? ' ✓' : ' ✗'} / ${row.year ?? '—'}${row.year_correct === undefined ? '' : row.year_correct ? ' ✓' : ' ✗'}`,pct(row.precision),pct(row.recall),pct(row.f1),row.brier?.toFixed(3) ?? '—',`${row.seconds}s`];
      for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}const sourceCell=document.createElement('td');
      for(const source of row.sources || []) {
        try { const url=new URL(source.url); if(!['http:','https:'].includes(url.protocol))continue;
          const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${source.title} (${source.origin})`;sourceCell.append(a,document.createElement('br'));
        } catch {}
      }
      const note=document.createElement('p');note.textContent=[row.source_warning, row.unreviewed_tags?.length ? `Unreviewed extras: ${row.unreviewed_tags.join(', ')}` : ''].filter(Boolean).join(' ');sourceCell.append(note);tr.append(sourceCell);table.append(tr);
    }
    scroll.append(table);details.append(scroll);
    const button=document.createElement('button');button.textContent='Export run (includes usage and resolved model)';button.className='secondary';button.onclick=()=>download(`ai-run-${run.id}.json`,run);details.append(button);
    $('runs').append(details);
  }
}
async function load(){const data=await api('ai');$('base').value=data.base_url;$('model').value=data.model;$('model2').value=data.model_2;$('model3').value=data.model_3;savedModels=[...new Set([data.model,data.model_2,data.model_3].map(m=>(m||'').trim()).filter(Boolean))];$('tokens').value=data.max_tokens;$('web').checked=data.web_search;$('key').placeholder=data.key_configured?'•••••••• (saved)':'Enter API key';render(data.runs);}
async function starter(){const r=await fetch('/evals/tag-benchmark.json');if(!r.ok)throw new Error('Could not load starter dataset');$('dataset').value=JSON.stringify(await r.json(),null,2);}
$('settings').onsubmit=async e=>{e.preventDefault();if(!confirm('Update AI settings?'))return;try{const body={ai_base_url:$('base').value.trim(),ai_model:$('model').value.trim(),ai_model_2:$('model2').value.trim(),ai_model_3:$('model3').value.trim(),ai_max_tokens:Number($('tokens').value),ai_web_search:$('web').checked};if($('key').value)body.ai_api_key=$('key').value;await api('ai/config',body);$('key').value='';await load();status('Settings saved.');}catch(e){status(e.message);}};
$('starter').onclick=()=>{if(confirm('Replace the dataset in the editor?'))starter().catch(e=>status(e.message));};
$('import').onchange=async()=>{try{const f=$('import').files[0];if(!f)return;if(f.size>65536)throw new Error('Dataset must be under 64 KB');$('dataset').value=JSON.stringify(JSON.parse(await f.text()),null,2);}catch(e){status(e.message);}};
$('export').onclick=()=>{try{download('tag-benchmark.json',JSON.parse($('dataset').value));}catch(e){status(e.message);}};
$('run').onclick=async()=>{try{const cases=JSON.parse($('dataset').value);if(!Array.isArray(cases)||!cases.length||cases.length>50)throw new Error('Use 1–50 test tracks.');if(!savedModels.length)throw new Error('Save at least one model first.');if(!confirm(`Make ${cases.length*savedModels.length} requests: ${cases.length} tracks × ${savedModels.length} models to the saved AI endpoint? Model and web-search charges may apply with the saved settings.`))return;$('run').disabled=true;$('settings').querySelector('button').disabled=true;status(`Running ${cases.length*savedModels.length} requests… Keep this page open (up to 45 seconds per track).`);const result=await api('ai/run',cases);await load();status(`Saved: ${result.summary.attempted}/${result.summary.total} attempted, ${result.summary.completed} succeeded, ${result.summary.failed} failed. F1 ${pct(result.summary.macro_f1)}.`);}catch(e){status(e.message);}finally{$('run').disabled=false;$('settings').querySelector('button').disabled=false;}};
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
