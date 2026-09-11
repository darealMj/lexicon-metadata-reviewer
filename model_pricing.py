"""Public OpenRouter catalog pricing. No credentials or inference requests."""
import json,math,threading,time
from urllib.request import Request,urlopen
LOCK=threading.Lock()
CACHE=None
SAVED=0

def price(value):
    try: result=float(value)
    except (TypeError,ValueError):return None
    return result*1_000_000 if math.isfinite(result) and result>=0 else None

def normalize(models):
    result={}
    for model in models:
        if not isinstance(model,dict) or not isinstance(model.get('id'),str):continue
        p=model.get('pricing') or {}
        result[model['id']]={'input':price(p.get('prompt')),'output':price(p.get('completion'))}
    return result

def catalog(context):
    global CACHE,SAVED
    with LOCK:
        if CACHE is not None and time.time()-SAVED<300:return {'models':CACHE,'checked_at':SAVED}
        try:
            req=Request('https://openrouter.ai/api/v1/models',headers={'Accept':'application/json'})
            with urlopen(req,context=context,timeout=12) as response:raw=response.read(8_000_001)
            if len(raw)>8_000_000:raise ValueError()
            data=json.loads(raw)['data']
            if not isinstance(data,list):raise ValueError()
            CACHE=normalize(data);SAVED=time.time()
            return {'models':CACHE,'checked_at':SAVED}
        except Exception:
            return {'models':{},'error':'Pricing unavailable','checked_at':None}
