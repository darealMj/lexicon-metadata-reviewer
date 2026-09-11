"""Separate local DJ edit markers from the title used for source searches."""
import re

MARKER = r'(?:super[ -]+clean|radio[ -]+edit|clean|dirty|raw|explicit|instrumental|extended|intro|outro)'
GROUP = rf'{MARKER}(?:[\s,/&+-]+{MARKER})*(?:\s+(?:edit|version))?'

def search_metadata(artist, title):
    markers = []
    def remove(match):
        markers.extend(m.group(0) for m in re.finditer(MARKER, match.group(0), re.I))
        return ' '
    base = re.sub(rf'\(({GROUP})\)|\[({GROUP})\]', remove, title, flags=re.I)
    # Only suffix markers, never words embedded in the song or named remix.
    while True:
        match = re.search(rf'(?:\s+[-–—:]\s*|\s+)({GROUP})\s*$', base, re.I)
        if not match or not base[:match.start()].strip():break
        # A named remix/version must retain its identifying text.
        if re.search(r'\b(remix|bootleg|mashup|refix|redrum)\b', base[:match.start()], re.I):break
        remove(match)
        base = base[:match.start()]
    base = ' '.join(base.split()).strip()
    if not base:return {'artist':artist,'title':title}
    result = {'artist':artist,'title':base}
    if base != title and markers:
        result.update(original_title=title, version_markers=list(dict.fromkeys(m.lower() for m in markers)))
    return result
