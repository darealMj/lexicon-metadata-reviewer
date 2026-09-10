"""Private dotenv settings, parsed as data (no shell expansion or execution)."""
import json, os, tempfile, threading

LOCK = threading.RLock()
DEFAULTS = {'sonovault_api_key':'', 'audiodb_api_key':'123', 'advanced_mode':False,
            'overwrite_custom_tags':False, 'include_mix_tags_from_title':True,
            'show_debug_log':False, 'theme':'system', 'ai_api_key':'',
            'ai_base_url':'https://openrouter.ai/api/v1', 'ai_model':'', 'ai_model_2':'', 'ai_model_3':'', 'ai_max_tokens':4096, 'ai_web_search':True}
ENV_NAMES = {key:key.upper() for key in DEFAULTS}

def validate(changes):
    if not isinstance(changes, dict) or any(k not in DEFAULTS for k in changes):
        raise ValueError('Unknown configuration setting')
    for key, value in changes.items():
        if isinstance(DEFAULTS[key], bool):
            if not isinstance(value, bool): raise ValueError(key + ' must be true or false')
        elif key == 'ai_max_tokens':
            if type(value) is not int or not 256 <= value <= 32768:
                raise ValueError('AI token limit must be an integer between 256 and 32768')
        elif key == 'theme':
            if value not in ('system', 'light', 'dark'): raise ValueError('theme must be light, dark, or system')
        elif not isinstance(value, str) or len(value) > 4096:
            raise ValueError('Invalid API key')

def parse(path):
    values = {}
    with open(path, encoding='utf-8') as file:
        for number, raw in enumerate(file, 1):
            line = raw.strip()
            if not line or line.startswith('#'): continue
            if line.startswith('export '): line = line[7:].lstrip()
            if '=' not in line: raise ValueError('Invalid .env assignment at line ' + str(number))
            name, value = line.split('=', 1); name = name.strip(); value = value.strip()
            if not name or not name.replace('_','a').isalnum() or name[0].isdigit():
                raise ValueError('Invalid .env variable name at line ' + str(number))
            if value.startswith('"'):
                try: value = json.loads(value)
                except ValueError: raise ValueError('Invalid quoted .env value at line ' + str(number)) from None
                if not isinstance(value, str): raise ValueError('Expected text in .env')
            elif value.startswith("'"):
                if len(value) < 2 or not value.endswith("'"): raise ValueError('Unclosed quote in .env')
                value = value[1:-1]
            else:
                value = value.split(' #', 1)[0].rstrip()
            values[name] = value
    return values

def encode(value):
    return ('true' if value else 'false') if isinstance(value, bool) else str(value)

def write(path, values):
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.env-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            file.write('# Private local settings. Do not commit this file.\n')
            for key, value in values.items():
                file.write(key + '=' + json.dumps(value, ensure_ascii=False) + '\n')
            file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def ensure(path):
    with LOCK:
        if os.path.exists(path): return
        config = dict(DEFAULTS)
        legacy = os.path.join(os.path.dirname(path), 'config.json')
        if os.path.isfile(legacy):
            with open(legacy, encoding='utf-8') as file: old = json.load(file)
            if not isinstance(old, dict): raise ValueError('Legacy config.json must contain an object')
            config.update({key:old[key] for key in DEFAULTS if key in old})
        validate(config)
        write(path, {ENV_NAMES[key]:encode(value) for key,value in config.items()})

def read(path):
    with LOCK:
        ensure(path); values = parse(path)
        config = {}
        for key, default in DEFAULTS.items():
            value = values.get(ENV_NAMES[key], encode(default))
            # Only API credentials have process-environment overrides.
            if key.endswith('_api_key'): value = os.environ.get(ENV_NAMES[key]) or value
            if isinstance(default, bool):
                if value.lower() not in ('true', 'false'): raise ValueError(ENV_NAMES[key] + ' must be true or false')
                value = value.lower() == 'true'
            elif key == 'ai_max_tokens':
                try: value = int(value)
                except ValueError: raise ValueError('AI_MAX_TOKENS must be an integer') from None
            elif key.endswith('_api_key'): value = value.strip()
            config[key] = value
        config['audiodb_api_key'] = config['audiodb_api_key'] or '123'
        validate(config)
        return config

def save(path, changes):
    validate(changes)
    with LOCK:
        ensure(path); values = parse(path)
        values.update({ENV_NAMES[key]:encode(value) for key,value in changes.items()})
        write(path, values)
