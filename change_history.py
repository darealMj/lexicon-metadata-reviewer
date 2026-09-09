"""Durable before/after journal for reviewer writes; no direct audio-file operations."""
import json, os, tempfile, threading, time, uuid

LOCK = threading.RLock()
FIELDS = {'title', 'artist', 'albumTitle', 'genre', 'year', 'trackNumber', 'label', 'tags'}

def read(path):
    if not os.path.exists(path):
        return []
    with open(path) as file:
        entries = json.load(file)
    if not isinstance(entries, list):
        raise ValueError('Invalid change history file; no write sent')
    return entries

def save(path, entries):
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.history-')
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(entries, file, indent=2)
            file.write('\n'); file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def snapshot(track):
    location = track.get('location', track.get('filePath', track.get('path', '')))
    return {'fields': {key:track[key] for key in FIELDS if key in track},
            'location': location, 'filename': os.path.basename(location or '')}

def same(key, left, right):
    return sorted(left or []) == sorted(right or []) if key == 'tags' else left == right

def apply(path, track_id, edits, get_track, patch_track):
    if not isinstance(track_id, int) or isinstance(track_id, bool) or track_id <= 0:
        raise ValueError('Invalid track ID')
    if not isinstance(edits, dict) or not edits or not set(edits) <= FIELDS:
        raise ValueError('Unsupported track edits')
    with LOCK:
        entries = read(path)
        if any(e['track_id'] == track_id and e['status'] in ('pending', 'restoring') for e in entries):
            raise ValueError('An earlier write has an uncertain outcome. Check change-history.json before writing again.')
        before = snapshot(get_track(track_id))
        if not set(edits) <= before['fields'].keys():
            raise ValueError('Cannot back up all requested fields; no write sent')
        edits = {k:v for k,v in edits.items() if not same(k, before['fields'][k], v)}
        if not edits: return {'unchanged': True}
        entry = {'id':uuid.uuid4().hex, 'track_id':track_id, 'time':time.time(), 'status':'pending', 'before':before, 'requested':edits}
        entries.append(entry); save(path, entries)  # Backup must succeed before the write.
        patch_track(track_id, edits)
        entry['after'] = snapshot(get_track(track_id))
        if any(not same(k, entry['after']['fields'].get(k), v) for k,v in edits.items()):
            save(path, entries)
            raise ValueError('Write could not be verified; original values remain in change-history.json')
        entry['status'] = 'applied'
        own = [e for e in entries if e['track_id'] == track_id and e['status'] not in ('pending', 'restoring')]
        remove = {e['id'] for e in own[:-3]}
        save(path, [e for e in entries if e['id'] not in remove])
        return {'recorded': True}

def restore(path, entry_id, get_track, patch_track):
    with LOCK:
        entries = read(path)
        entry = next((e for e in entries if e['id'] == entry_id), None)
        if not entry or entry['status'] != 'applied':
            raise ValueError('This change is not available for restore')
        active = [e for e in entries if e['track_id'] == entry['track_id'] and e['status'] != 'restored']
        if active[-1]['id'] != entry_id:
            raise ValueError('Restore the newest change for this song first')
        current = snapshot(get_track(entry['track_id']))
        keys = entry['requested'].keys()
        if any(not same(k, current['fields'].get(k), entry['after']['fields'].get(k)) for k in keys):
            raise ValueError('These fields changed since this edit. Restore stopped to preserve newer changes.')
        edits = {k:entry['before']['fields'][k] for k in keys}
        entry['restore_before'] = current; entry['status'] = 'restoring'; save(path, entries)
        patch_track(entry['track_id'], edits)
        after = snapshot(get_track(entry['track_id']))
        if any(not same(k, after['fields'].get(k), v) for k,v in edits.items()):
            raise ValueError('Restore could not be verified; the backup remains in change-history.json')
        entry['status'] = 'restored'; entry['restored_at'] = time.time(); entry['restore_after'] = after
        save(path, entries)
        return {'restored': True, 'track_id':entry['track_id']}
