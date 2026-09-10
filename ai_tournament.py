"""Bounded model discovery; no provider calls until the user starts a previewed plan."""
import hashlib
import json
import math
import random
import threading
import time
import uuid
from urllib.request import Request, build_opener, HTTPSHandler
from urllib.parse import urlparse
import ai_tags

PLANS = {}
LOCK = threading.Lock()

def provider_get(path, config, context):
    if urlparse(config['ai_base_url']).hostname != 'openrouter.ai':
        raise ValueError('Random benchmarks require OpenRouter.')
    headers = {'Authorization':'Bearer '+config['ai_api_key']} if config['ai_api_key'] else {}
    try:
        with build_opener(ai_tags.NoRedirect(), HTTPSHandler(context=context)).open(Request('https://openrouter.ai/api/v1/'+path,headers=headers),timeout=30) as response:
            raw=response.read(8_000_001)
        if len(raw)>8_000_000: raise ValueError()
        return json.loads(raw)['data']
    except Exception:
        raise ValueError('Could not read OpenRouter model catalog or key limit. Check key and connection.') from None

def number(value, label, low, high):
    if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError(label+' is outside the allowed range.')
    return value

def eligible(catalog, ceiling, tokens, web):
    output=[]
    for model in catalog:
        try:
            name=model['id']; price=model['pricing']; architecture=model['architecture']
            prompt=float(price['prompt']); completion=float(price['completion'])
            if not all(math.isfinite(p) and 0<=p<=ceiling/1_000_000 for p in (prompt,completion)):continue
            if not isinstance(name,str) or name.startswith('openrouter/') or ':online' in name:continue
            if 'text' not in architecture.get('input_modalities',[]) or architecture.get('output_modalities')!=['text']:continue
            if web and 'tools' not in model.get('supported_parameters',[]):continue
            limit=(model.get('top_provider') or {}).get('max_completion_tokens')
            if limit is not None and limit<tokens:continue
            if model.get('context_length',0)<tokens+2048:continue
            output.append({'id':name,'input_per_million':prompt*1_000_000,'output_per_million':completion*1_000_000})
        except (KeyError,TypeError,ValueError):continue
    return list({m['id']:m for m in output}.values())

def check_budget(config, budget, context):
    key=provider_get('key',config,context)
    remaining=key.get('limit_remaining')
    if type(remaining) not in (int,float) or not math.isfinite(remaining) or not 0<remaining<=budget or key.get('limit_reset') or not key.get('include_byok_in_limit'):
        raise ValueError('For a bounded random run, use an OpenRouter key with a non-resetting credit limit, remaining credit no greater than the run budget, and BYOK included in the limit. Configure this in OpenRouter key settings.')
    return remaining

def preview(config, body, context):
    if not isinstance(body,dict):raise ValueError('Invalid benchmark options.')
    cases=ai_tags.validate_cases(body.get('cases'))
    count=number(body.get('count'), 'Model count',1,3)
    if type(count) is not int:raise ValueError('Model count must be an integer.')
    ceiling=number(body.get('price'), 'Price per million tokens',0,100)
    budget=number(body.get('budget'), 'Budget',0.01,100)
    reviewed=body.get('reviewed',False)
    if type(reviewed) is not bool:raise ValueError('Invalid reviewed flag.')
    pool=eligible(provider_get('models',config,context),ceiling,config['ai_max_tokens'],config['ai_web_search'])
    incumbent=config['ai_model'].strip()
    incumbent_entry=next((m for m in pool if m['id']==incumbent),None)
    selected=([incumbent_entry] if incumbent_entry else [])
    candidates=[m for m in pool if m['id']!=incumbent]
    selected+=random.SystemRandom().sample(candidates,min(count-len(selected),len(candidates)))
    if not selected:raise ValueError('No eligible models match this price and capability filter.')
    token=str(uuid.uuid4())
    public={'id':token,'models':selected,'eligible_count':len(pool),'requests':len(cases)*len(selected),
            'budget':budget,'incumbent':incumbent,'reviewed':reviewed,'web_search':config['ai_web_search']}
    with LOCK:
        for old in list(PLANS):
            if PLANS[old]['expires']<time.time():del PLANS[old]
        if len(PLANS)>=20:raise ValueError('Too many previews. Wait for older previews to expire.')
        PLANS[token]={'public':public,'cases':cases,'config':dict(config),'expires':time.time()+900}
    return public

def ranking(result, plan):
    cases=result['cases']
    # Split by artist so versions of the same song cannot straddle the split.
    artists=sorted({c['artist'].casefold().strip() for c in cases},key=lambda s:hashlib.sha256(s.encode()).hexdigest())
    hold_artists=set(artists[:max(1,len(artists)//4)])
    hold={c['id'] for c in cases if c['artist'].casefold().strip() in hold_artists}
    train={c['id'] for c in cases}-hold
    def quality(row,case):
        metrics=[]
        if case['expected_tags'] is not None:metrics.append(row.get('f1',0))
        for field,key in [('expected_albums','album_correct'),('expected_year','year_correct')]:
            if field in case:metrics.append(float(row.get(key,False)))
        return sum(metrics)/len(metrics) if metrics else 0
    boards=[]
    for model in result['models']:
        rows=[r for r in result['results'] if r['model']==model]
        by_id={r['id']:r for r in rows}
        def avg(ids):return sum(quality(by_id.get(c['id'],{}),c) for c in cases if c['id'] in ids)/len(ids) if ids else 0
        costs=[r.get('usage',{}).get('cost') for r in rows]
        known=all(type(c) in (int,float) and math.isfinite(c) and c>=0 for c in costs)
        boards.append({'model':model,'training_score':avg(train),'holdout_score':avg(hold),
            'failures':sum('error' in r for r in rows),'seconds':sum(r['seconds'] for r in rows),
            'reported_cost':sum(costs) if known else None})
    boards.sort(key=lambda b:(-b['training_score'],b['failures'],b['reported_cost'] if b['reported_cost'] is not None else float('inf'),b['seconds'],b['model']))
    best=boards[0]; incumbent=next((b for b in boards if b['model']==plan['incumbent']),None)
    qualified=(plan['reviewed'] and len(cases)>=20 and len(train)>=15 and len(hold)>=5 and len(artists)>=5
        and best['failures']==0 and best['training_score']>=.8 and best['holdout_score']>=.8
        and incumbent is not None and (best['model']==incumbent['model'] or
            (best['training_score']>=incumbent['training_score']+.05 and best['holdout_score']>=incumbent['holdout_score']+.05)))
    return {'leaderboard':boards,'training_ids':sorted(train),'holdout_ids':sorted(hold),
        'provisional_winner':best['model'],'promote':best['model'] if qualified else None,
        'selection_note':'Qualified for selection.' if qualified else 'Provisional only: automatic selection needs reviewed data, 20+ tracks (15 training / 5 holdout), 5+ artists, zero winner failures, scores ≥80%, and a tested incumbent. Challengers must beat it by 5 points on both splits.'}

def execute(body, config, path, context, save_config):
    if not isinstance(body,dict) or not isinstance(body.get('id'),str):raise ValueError('Invalid preview.')
    with LOCK:
        plan=PLANS.get(body['id'])
        if not plan or plan['expires']<time.time():raise ValueError('Preview expired. Preview models again.')
        if plan['config']!=config:raise ValueError('Settings changed. Preview models again.')
    check_budget(config,plan['public']['budget'],context)
    with LOCK:
        if PLANS.pop(body['id'],None) is None:raise ValueError('This preview was already used.')
    chosen=[m['id'] for m in plan['public']['models']]
    run_config={**config,**{k:chosen[i] if i<len(chosen) else '' for i,k in enumerate(('ai_model','ai_model_2','ai_model_3'))}}
    def finish(result):
        result['tournament']={**plan['public'],**ranking(result,plan['public'])}
    result=ai_tags.run(run_config,plan['cases'],path,context,finalize=finish)
    if result['tournament']['promote']:
        # Do not override settings edited while this long-running evaluation ran.
        save_config(result['tournament']['promote'],config)
    return result
