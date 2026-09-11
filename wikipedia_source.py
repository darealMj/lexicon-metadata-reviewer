"""Conservative English Wikipedia song-infobox evidence via MediaWiki API."""
import json,re,unicodedata,datetime
from search_title import search_metadata
from html.parser import HTMLParser
from urllib.parse import urlencode,quote
from urllib.request import Request,urlopen

class Infobox(HTMLParser):
    def __init__(self):
        super().__init__();self.depth=0;self.rows=[];self.row=None;self.cell=None;self.skip=0;self.done=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='table':
            if self.depth:self.depth+=1
            elif not self.done and 'infobox' in attrs.get('class','').split():self.depth=1
        if not self.depth:return
        if tag in ('sup','style','script'):self.skip+=1
        if tag=='tr' and self.depth==1:self.row=[]
        if tag in ('td','th') and self.depth==1:self.cell=[]
        if tag in ('br','li') and self.cell is not None:self.cell.append(' | ')
    def handle_endtag(self,tag):
        if not self.depth:return
        if tag in ('sup','style','script') and self.skip:self.skip-=1
        if tag in ('th','td') and self.depth==1 and self.cell is not None:
            if self.row is not None:self.row.append(' '.join(''.join(self.cell).split()).strip(' |'))
            self.cell=None
        if tag=='tr' and self.depth==1 and self.row is not None:self.rows.append(self.row);self.row=None
        if tag=='table':
            self.depth-=1
            if not self.depth:self.done=True
    def handle_data(self,data):
        if self.depth and not self.skip and self.cell is not None:self.cell.append(data)

def norm(value):
    return ' '.join(re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()).split())

def extract(html,page_title,artist,title):
    parser=Infobox();parser.feed(html)
    rows=parser.rows
    headings=' '.join(' '.join(row) for row in rows if len(row)==1)
    # Require the first song infobox and explicit artist attribution, not mentions elsewhere.
    if norm(page_title.split(' (')[0])!=norm(title):return None
    if not re.search(r'\b(single|song) by\b',headings,re.I):return None
    if not re.search(r'\b'+re.escape(norm(artist))+r'\b',norm(headings)):return None
    fields={}
    for row in rows:
        if len(row)==1 and row[0].lower().startswith('from the album '):
            fields['album']=row[0][len('from the album '):][:700]
        if len(row)!=2:continue
        key=row[0].strip().lower()
        if key in ('genre','released','from the album','album'):
            fields[key]=row[1][:700]
    return fields if fields else None

def api(params,context):
    url='https://en.wikipedia.org/w/api.php?'+urlencode({'format':'json','formatversion':2,**params})
    request=Request(url,headers={'User-Agent':'LexiconMetadataReviewer/1.0 (https://github.com/darealMJ/lexicon-metadata-reviewer)'})
    with urlopen(request,context=context,timeout=12) as response:raw=response.read(2_000_001)
    if len(raw)>2_000_000:raise ValueError('Wikipedia response too large')
    result=json.loads(raw)
    if 'error' in result:raise ValueError('Wikipedia API error')
    return result

def lookup(artist,title,context):
    if re.search(r'\b(remix|bootleg|mashup|refix|redrum|re-drum)\b',title,re.I):
        return {'status':'skipped','warning':'Wikipedia original-song metadata was not reused for this remix/version.'}
    # Strip only explicitly bracketed clean/instrumental edits; preserve other title text.
    base=search_metadata(artist,title)['title']
    try:
        hits=api({'action':'query','list':'search','srsearch':f'"{base}" "{artist}"','srlimit':3,'srnamespace':0},context)['query']['search']
        matches=[]
        for hit in hits:
            if norm(hit['title'].split(' (')[0])!=norm(base):continue
            page=api({'action':'parse','pageid':hit['pageid'],'prop':'text|revid','section':0},context)['parse']
            fields=extract(page['text'],page['title'],artist,base)
            if fields:
                matches.append({'status':'matched','title':page['title'],'url':'https://en.wikipedia.org/wiki/'+quote(page['title'].replace(' ','_')),
                    'revision_id':page.get('revid'),'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'fields':fields,'version_note':'Original song evidence; local edit may differ.' if base!=title else None})
        if len(matches)==1:return matches[0]
        return {'status':'unresolved','warning':'Wikipedia match is ambiguous or no matching song infobox was found; other AI evidence may be used.'}
    except Exception:
        return {'status':'unavailable','warning':'Wikipedia could not be retrieved; continuing with the configured AI lookup.'}
