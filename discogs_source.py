"""Read-only Discogs release search with local response caching."""
import json, time, re
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPSHandler
from urllib.error import HTTPError, URLError
from ai_tags import NoRedirect, normalized
from search_title import search_metadata
import ai_library

def search_artist(artist):
    # Featured credits remain in the local record; search the primary artist.
    return re.split(r'\s+(?:feat\.?|ft\.?|featuring)\s+',artist,maxsplit=1,flags=re.I)[0].strip()

def fetch(action, params, token, context, connection):
    if action not in ('search','record'):raise ValueError('Unsupported Discogs request')
    if action=='record' and not params.get('id','').isdigit():raise ValueError('Enter a numeric Discogs release ID')
    key='discogs-v2:'+json.dumps([action,params],sort_keys=True)
    db=connection()
    try:
        row=db.execute('SELECT body FROM responses WHERE key=?',(key,)).fetchone()
        if row:return json.loads(row[0])
        if not token:raise ValueError('Add your Discogs personal access token in Settings, then retry.')
        query=search_metadata(params.get('artist',''),params.get('title',''))
        path='/releases/'+params['id'] if action=='record' else '/database/search?'+urlencode({'type':'release','artist':search_artist(query['artist']),'track':query['title'],'per_page':10})
        req=Request('https://api.discogs.com'+path,headers={'Authorization':'Discogs token='+token,'User-Agent':'LexiconMetadataReviewer/1.0','Accept':'application/json'})
        try:
            with build_opener(NoRedirect(),HTTPSHandler(context=context)).open(req,timeout=30) as r:raw=r.read(2_000_001)
            if len(raw)>2_000_000:raise ValueError('Discogs response too large')
            data=json.loads(raw)
        except HTTPError as e:raise ValueError(f'Discogs HTTP {e.code}; check token or rate limit. No retry attempted.') from None
        except (URLError,TimeoutError):raise ValueError('Could not reach Discogs. No retry attempted.') from None
        except json.JSONDecodeError:raise ValueError('Discogs returned invalid JSON.') from None
        db.execute('INSERT OR REPLACE INTO responses VALUES (?,?,?)',(key,json.dumps(data),time.time()));db.commit()
        return data
    finally:db.close()

def release_result(data, artist, title, tag_data):
    tags=ai_library.taxonomy(tag_data)
    genres=data.get('genres') or [];styles=data.get('styles') or []
    source_labels=list(dict.fromkeys(genres+styles))
    allowed={normalized(t['label']):t for t in tags}
    selected=[allowed[normalized(s)] for s in source_labels if normalized(s) in allowed]
    main=next((t['label'] for t in selected if t['category']=='Genre'),None)
    base=normalized(search_metadata(artist,title)['title'])
    matches=[t for t in data.get('tracklist',[]) if normalized(search_metadata(artist,t.get('title',''))['title'])==base]
    track=matches[0] if len(matches)==1 else {}
    warnings=['Discogs genres and styles describe the release; review their relevance to this track.']
    if not track:warnings.append('No unique matching track in this release. Title and artist suggestions are withheld.')
    if not main:warnings.append('Discogs genre/style labels do not match an existing Genre custom tag; current genre retained.')
    unmatched=[s for s in source_labels if normalized(s) not in allowed]
    if unmatched:warnings.append('Unmapped Discogs labels: '+', '.join(unmatched))
    return {'title':track.get('title'),'artists':[a['name'] for a in (track.get('artists') or data.get('artists') or []) if a.get('name')] if track else [],
        'album':data.get('title'),'year':data.get('year') or None,'label':', '.join(dict.fromkeys(l['name'] for l in data.get('labels',[]) if l.get('name'))),
        'main_genre':main,'categorized_tags':[{**t,'confidence':1} for t in selected], 'warnings':warnings,
        'genres':genres,'styles':styles,'sources':[{'url':'https://www.discogs.com/release/'+str(data['id']),'title':'Discogs release '+str(data['id']),'origin':'Discogs API'}]}
