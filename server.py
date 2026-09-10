#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json, os, ssl, sys, sqlite3, threading, time
from urllib.parse import parse_qs, urlencode

ROOT = os.path.dirname(os.path.abspath(__file__))
LEXICON = 'http://localhost:48624'
SONOVAULT = 'https://api.sonovault.now'
import importlib.util
_history_spec = importlib.util.spec_from_file_location('change_history', os.path.join(ROOT, 'change_history.py'))
history = importlib.util.module_from_spec(_history_spec)
_history_spec.loader.exec_module(history)
import ai_tags
import ai_tournament
import ai_library
AI_RUNS_FILE = os.path.join(ROOT, 'ai-evaluation-runs.json')
HISTORY_FILE = os.path.join(ROOT, 'change-history.json')

def lexicon_json(method, path, body=None):
    req = Request(LEXICON + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type':'application/json'}, method=method)
    with urlopen(req, timeout=30) as response:
        data = json.load(response)
    if isinstance(data, dict) and data.get('error'):
        raise ValueError('Lexicon rejected the update')
    return data

def history_track(track_id):
    data = lexicon_json('GET', '/v1/track?id=' + str(track_id))
    while isinstance(data, dict) and 'data' in data:
        data = data['data']
    track = data.get('track', data)
    if str(track.get('id')) != str(track_id):
        raise ValueError('Could not verify track identity')
    return track

def history_patch(track_id, edits):
    return lexicon_json('PATCH', '/v1/track', {'id':track_id, 'edits':edits})


def create_https_context():
    """Use verified TLS, with macOS roots when Python has no CA store."""
    context = ssl.create_default_context()
    # python.org macOS installs can point at a missing cert.pem until their
    # Install Certificates command is run. Use the OS bundle in that case.
    # Respect explicitly configured trust stores; never bypass verification.
    if (sys.platform == 'darwin'
            and not os.environ.get('SSL_CERT_FILE')
            and not os.environ.get('SSL_CERT_DIR')
            and context.cert_store_stats()['x509_ca'] == 0
            and os.path.isfile('/etc/ssl/cert.pem')):
        context.load_verify_locations(cafile='/etc/ssl/cert.pem')
    return context


HTTPS_CONTEXT = create_https_context()

CONFIG_FILE = os.path.join(ROOT, '.env')
_config_spec = importlib.util.spec_from_file_location('config_store', os.path.join(ROOT, 'config_store.py'))
config_store = importlib.util.module_from_spec(_config_spec)
_config_spec.loader.exec_module(config_store)
CACHE_FILE = os.path.join(ROOT, 'metadata-cache.sqlite3')
CACHE_LOCK = threading.RLock()


def read_config():
    return config_store.read(CONFIG_FILE)


def save_config(changes):
    config_store.save(CONFIG_FILE, changes)


def cache_connection():
    db = sqlite3.connect(CACHE_FILE)
    os.chmod(CACHE_FILE, 0o600)
    db.execute('CREATE TABLE IF NOT EXISTS records (provider TEXT, id TEXT, body TEXT, saved_at REAL, PRIMARY KEY(provider,id))')
    db.execute('CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, body TEXT, saved_at REAL)')
    return db


def provider_records(provider, body):
    if provider == 'audiodb':
        records = body.get('track') or []
    else:
        while isinstance(body, dict) and 'data' in body:
            body = body['data']
        if isinstance(body, list):
            records = body
        elif isinstance(body, dict):
            records = next((body[k] for k in ['results', 'tracks', 'items'] if isinstance(body.get(k), list)), None)
            if records is None:
                records = [body.get('track', body)]
        else:
            records = []
    return [r for r in records if isinstance(r, dict)]


def record_id(provider, record):
    value = record.get('idTrack') if provider == 'audiodb' else record.get('id', record.get('track_id', record.get('trackId')))
    return str(value) if isinstance(value, (str, int)) and str(value).isdigit() else None


def fetch_provider(provider, action, params):
    config = read_config()
    headers = {'Accept': 'application/json'}
    if provider == 'audiodb':
        key = config['audiodb_api_key']
        from urllib.parse import quote
        base = 'https://www.theaudiodb.com/api/v1/json/' + quote(key, safe='')
        url = base + ('/track.php?' + urlencode({'h': params['id']}) if action == 'record' else '/searchtrack.php?' + urlencode({'s': params.get('artist',''), 't': params.get('title','')}))
    else:
        key = config['sonovault_api_key']
        if not key:
            raise ValueError('Set sonovault_api_key in config.json once, then retry. Existing cached records remain available without a key.')
        headers['x-api-key'] = key
        url = SONOVAULT + ('/v1/tracks/' + params['id'] if action == 'record' else '/v1/tracks/search?' + urlencode(params))
    try:
        with urlopen(Request(url, headers=headers), timeout=30, context=HTTPS_CONTEXT) as response:
            return json.load(response)
    except HTTPError as e:
        # Provider errors/URLs can contain credentials. Return only the status.
        raise ValueError(f'{provider} HTTP {e.code}; check your configured key or provider quota.') from None
    except URLError as e:
        if isinstance(e.reason, ssl.SSLCertVerificationError):
            raise ValueError('Provider certificate verification failed; check the server certificate setup.') from None
        raise ValueError('Could not connect to the metadata provider; please retry.') from None


def cached_metadata(provider, action, params):
    if provider not in ('audiodb','sonovault') or action not in ('search','record'):
        raise ValueError('Unsupported provider request')
    if action == 'record' and not params.get('id','').isdigit():
        raise ValueError('Enter a numeric provider track ID')
    cache_key = json.dumps([provider, action, params], sort_keys=True)
    with CACHE_LOCK:
        db = cache_connection()
        try:
            if action == 'record':
                row = db.execute('SELECT body FROM records WHERE provider=? AND id=?', (provider, params['id'])).fetchone()
                if row:
                    raw = json.loads(row[0])
                    return {'track':[raw]} if provider == 'audiodb' else raw, True
            else:
                row = db.execute('SELECT body FROM responses WHERE key=?', (cache_key,)).fetchone()
                if row:
                    return json.loads(row[0]), True
            body = fetch_provider(provider, action, params)
            records = provider_records(provider, body)
            if action == 'record' and not any(record_id(provider,r)==params['id'] for r in records):
                raise ValueError('Provider did not return the requested track ID')
            now = time.time()
            for record in records:
                rid = record_id(provider, record)
                if rid:
                    db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)',(provider,rid,json.dumps(record),now))
            if action == 'search':
                db.execute('INSERT OR REPLACE INTO responses VALUES (?,?,?)',(cache_key,json.dumps(body),now))
            db.commit()
            return body, False
        finally:
            db.close()


def clear_metadata_cache():
    with CACHE_LOCK:
        db = cache_connection()
        try:
            with db:
                db.execute('DELETE FROM records')
                db.execute('DELETE FROM responses')
        finally:
            db.close()


def saved_records():
    with CACHE_LOCK:
        db = cache_connection()
        try:
            return [{'provider':p, 'record':json.loads(b)} for p,b in db.execute('SELECT provider,body FROM records ORDER BY saved_at DESC')]
        finally:
            db.close()


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = unquote(urlparse(path).path)
        if path == '/':
            path = '/index.html'
        public_files = {
            '/index.html', '/ai-lab.html', '/js/ai-lab.js', '/styles/ai-lab.css', '/evals/tag-benchmark.json',
            '/assets/logo.svg',
            '/js/api.js',
            '/js/app.js',
            '/js/csv.js',
            '/js/dom.js',
            '/js/history.js',
            '/js/lexicon.js',
            '/js/metadata.js',
            '/js/model.js',
            '/js/render.js',
            '/js/review.js',
            '/js/settings.js',
            '/js/state.js',
            '/js/tags.js',
            '/js/utils.js',
            '/styles/base.css',
            '/styles/themes.css',
        }
        return os.path.join(ROOT, path.lstrip('/') if path in public_files else '__blocked_path__')

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def metadata_request(self):
        parts = urlparse(self.path).path.strip('/').split('/')
        try:
            if parts == ['metadata','ai']:
                config = read_config()
                return self.send_json({'base_url':config['ai_base_url'], 'model':config['ai_model'], 'model_2':config['ai_model_2'], 'model_3':config['ai_model_3'], 'max_tokens':config['ai_max_tokens'], 'web_search':config['ai_web_search'], 'key_configured':bool(config['ai_api_key']), 'runs':ai_tags.read_runs(AI_RUNS_FILE)})
            if parts == ['metadata','config']:
                config = read_config()
                return self.send_json({'config_storage':'env', 'audiodb_configured':bool(config['audiodb_api_key']), 'sonovault_configured':bool(config['sonovault_api_key']), **{key:config[key] for key in ('advanced_mode', 'overwrite_custom_tags', 'include_mix_tags_from_title', 'show_debug_log', 'theme')}})
            if parts == ['metadata','history']:
                with history.LOCK:
                    return self.send_json({'entries':history.read(HISTORY_FILE)})
            if parts == ['metadata','records']:
                return self.send_json({'records':saved_records()})
            if len(parts) != 3:
                return self.send_json({'error':'Unknown metadata route'},404)
            query = parse_qs(urlparse(self.path).query)
            fields = ['id'] if parts[2]=='record' else ['artist','title']
            params = {k:query.get(k,[''])[0].strip() for k in fields}
            body, cached = cached_metadata(parts[1], parts[2], params)
            return self.send_json({'payload':body,'cached':cached})
        except (ValueError, OSError, sqlite3.Error) as e:
            # Do not include file content, credentials, or upstream request URLs.
            message = str(e) if isinstance(e,ValueError) and not isinstance(e,json.JSONDecodeError) else 'Could not read local configuration/cache. Check .env and file permissions.'
            return self.send_json({'error':message},502)

    def end_headers(self):
        # Always serve the latest local app while debugging.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _proxy(self, base, prefix, forward_api_key=False):
        parsed = urlparse(self.path)
        target = base + parsed.path[len(prefix):]
        if parsed.query:
            target += '?' + parsed.query
        body = None
        length = int(self.headers.get('Content-Length', '0') or 0)
        if length:
            body = self.rfile.read(length)
        headers = {'Accept': 'application/json'}
        if body is not None:
            headers['Content-Type'] = self.headers.get('Content-Type', 'application/json')
        if forward_api_key:
            key = read_config()['sonovault_api_key']
            if key:
                headers['x-api-key'] = key
        print(f'[proxy] {self.command} {self.path} -> {target}', flush=True)
        req = Request(target, data=body, headers=headers, method=self.command)
        try:
            with urlopen(req, timeout=30, context=HTTPS_CONTEXT) as r:
                data = r.read()
                print(f'[proxy] <- {r.status} {target}', flush=True)
                self.send_response(r.status)
                self.send_header('Content-Type', r.headers.get('Content-Type', 'application/json'))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as e:
            data = e.read()
            print(f'[proxy] HTTP ERROR {e.code} {target}', flush=True)
            self.send_response(e.code)
            self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
            self.end_headers()
            self.wfile.write(data or json.dumps({'error': str(e)}).encode())
        except (URLError, TimeoutError) as e:
            print(f'[proxy] NETWORK ERROR {target} | {e}', flush=True)
            reason = getattr(e, 'reason', e)
            message = str(e)
            if isinstance(reason, ssl.SSLCertVerificationError):
                message = ('Could not verify the metadata provider HTTPS certificate. '
                           'Restart server.py after updating. If this persists, configure '
                           'SSL_CERT_FILE with a trusted CA bundle for this Python installation. '
                           'Certificate verification remains enabled.')
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': message, 'target': target}).encode())

    def do_GET(self):
        if self.path.startswith('/metadata/'):
            return self.metadata_request()
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith('/lexicon/'):
            return self._proxy(LEXICON, '/lexicon')
        if self.path.startswith('/sonovault/'):
            return self._proxy(SONOVAULT, '/sonovault', True)
        return super().do_GET()

    def allow_local_write(self):
        host = self.headers.get('Host', '')
        allowed = (host.split(':')[0] in ('127.0.0.1', 'localhost')
                   and self.headers.get('Origin') == 'http://' + host
                   and self.headers.get('Content-Type', '').split(';')[0] == 'application/json')
        if not allowed:
            self.send_json({'error':'Open the local reviewer to make changes'},403)
        return allowed

    def do_POST(self):
        if not self.allow_local_write(): return
        if self.path in ('/metadata/ai/config', '/metadata/ai/run', '/metadata/ai/preview', '/metadata/ai/tournament', '/metadata/ai/lookup'):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 65536: raise ValueError('Invalid AI request size')
                body = json.loads(self.rfile.read(length))
                if self.path.endswith('/lookup'):
                    return self.send_json(ai_library.lookup(read_config(), body, lexicon_json('GET','/v1/tags'), cache_connection, HTTPS_CONTEXT))
                if self.path.endswith('/preview'):
                    return self.send_json(ai_tournament.preview(read_config(), body, HTTPS_CONTEXT))
                if self.path.endswith('/tournament'):
                    def select_winner(model, original):
                        with config_store.LOCK:
                            if read_config() == original: save_config({'ai_model':model, 'ai_model_2':'', 'ai_model_3':''})
                    return self.send_json(ai_tournament.execute(body, read_config(), AI_RUNS_FILE, HTTPS_CONTEXT, select_winner))
                if self.path.endswith('/config'):
                    if not isinstance(body, dict) or any(k not in ('ai_api_key','ai_base_url','ai_model','ai_model_2','ai_model_3','ai_max_tokens','ai_web_search') for k in body):
                        raise ValueError('Invalid AI settings')
                    config_store.validate(body)
                    ai_tags.endpoint(body.get('ai_base_url', read_config()['ai_base_url']))
                    save_config(body)
                    return self.send_json({'saved':True})
                return self.send_json(ai_tags.run(read_config(), body, AI_RUNS_FILE, HTTPS_CONTEXT))
            except (ValueError, OSError) as error:
                return self.send_json({'error':str(error) if isinstance(error,ValueError) and not isinstance(error,json.JSONDecodeError) else 'AI operation failed. Check settings, dataset format, and local file permissions.'},400)
        if self.path in ('/metadata/config', '/metadata/cache/clear', '/metadata/history/restore'):
            host = self.headers.get('Host', '')
            if (host.split(':')[0] not in ('127.0.0.1', 'localhost') or
                    self.headers.get('Origin') != 'http://' + host or
                    self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                return self.send_json({'error':'Settings must be saved from this app'},403)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('Invalid settings request size')
                changes = json.loads(self.rfile.read(length))
                if self.path == '/metadata/history/restore':
                    if not isinstance(changes, dict) or not isinstance(changes.get('id'), str):
                        raise ValueError('Invalid history entry')
                    return self.send_json(history.restore(HISTORY_FILE, changes.get('id'), history_track, history_patch))
                if self.path == '/metadata/cache/clear':
                    if changes != {}:
                        raise ValueError('Invalid cache request')
                    clear_metadata_cache()
                    return self.send_json({'cleared': True})
                save_config(changes)
                return self.metadata_request()
            except (ValueError, OSError, sqlite3.Error) as error:
                if self.path == '/metadata/history/restore':
                    return self.send_json({'error':str(error) if isinstance(error,ValueError) else 'Restore failed; check the saved history before retrying.'},409)
                if isinstance(error, json.JSONDecodeError):
                    message = 'The request or legacy configuration contains invalid JSON. Check formatting before saving.'
                elif isinstance(error, PermissionError):
                    message = 'The reviewer cannot write .env in its app folder. Check folder permissions.'
                elif isinstance(error, ValueError):
                    message = str(error)
                else:
                    message = 'Could not write the local settings/cache file. Check available disk space and folder permissions.'
                return self.send_json({'error':message},400)
        if self.path.startswith('/lexicon/'):
            return self._proxy(LEXICON, '/lexicon')
        self.send_error(404)

    def do_PATCH(self):
        if not self.allow_local_write(): return
        if self.path == '/lexicon/v1/track':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 65536:
                    raise ValueError('Invalid edit size')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('Invalid track edit')
                if data.get('aiReview'):
                    ai_library.validate_apply(data.get('edits'), data['aiReview'], lexicon_json('GET','/v1/tags'))
                return self.send_json(history.apply(HISTORY_FILE, data.get('id'), data.get('edits'), history_track, history_patch))
            except (ValueError, OSError) as error:
                return self.send_json({'error':str(error) if isinstance(error,ValueError) else 'Write failed or outcome uncertain. Check change-history.json before retrying.'},409)
        if self.path.startswith('/lexicon/'):
            return self._proxy(LEXICON, '/lexicon')
        self.send_error(404)

if __name__ == '__main__':
    os.chdir(ROOT)
    read_config()  # Create private .env (or migrate legacy config) before serving.
    addr = ('127.0.0.1', 8765)
    print('Lexicon Metadata Reviewer: http://127.0.0.1:8765')
    print('Keep this window open while using the app. Press Ctrl+C to stop.')
    ThreadingHTTPServer(addr, Handler).serve_forever()
