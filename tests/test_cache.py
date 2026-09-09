import json, os, runpy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

module=runpy.run_path(str(Path(__file__).resolve().parents[1]/'server.py'))
g=module['cached_metadata'].__globals__

class CacheTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.state=patch.dict(g,{'CACHE_FILE':str(Path(self.tmp.name)/'cache.sqlite3'),'CONFIG_FILE':str(Path(self.tmp.name)/'.env')});self.state.start();self.addCleanup(self.state.stop)
 def test_search_record_and_restart_reuse(self):
  response={'track':[{'idTrack':'123','strTrack':'Example','strArtist':'Artist'}]}
  with patch.dict(g,{'fetch_provider':lambda *args:response}):
   body,cached=module['cached_metadata']('audiodb','search',{'artist':'Artist','title':'Example'});self.assertFalse(cached)
  def no_network(*args):raise AssertionError('Provider called on a cache hit')
  with patch.dict(g,{'fetch_provider':no_network}):
   self.assertTrue(module['cached_metadata']('audiodb','record',{'id':'123'})[1]);self.assertTrue(module['cached_metadata']('audiodb','search',{'artist':'Artist','title':'Example'})[1])
   # New module/server instance, same on-disk cache.
   fresh=runpy.run_path(str(Path(__file__).resolve().parents[1]/'server.py'));fresh['cached_metadata'].__globals__.update(CACHE_FILE=g['CACHE_FILE'],fetch_provider=no_network)
   self.assertTrue(fresh['cached_metadata']('audiodb','record',{'id':'123'})[1])
   self.assertEqual(len(fresh['saved_records']()),1)
 def test_clear_cache_and_refetch(self):
  config=Path(g['CONFIG_FILE']);config.write_text('{"sonovault_api_key":"test-only"}')
  calls=[]
  def provider(*args):calls.append(args);return {'track':[{'idTrack':'123'}]}
  with patch.dict(g,{'fetch_provider':provider}):
   module['cached_metadata']('audiodb','search',{'artist':'Artist','title':'Example'})
   module['clear_metadata_cache']()
   self.assertEqual(module['saved_records'](),[])
   db=module['cache_connection']()
   try:self.assertEqual(db.execute('SELECT count(*) FROM responses').fetchone()[0],0)
   finally:db.close()
   self.assertEqual(json.loads(config.read_text()),{'sonovault_api_key':'test-only'})
   self.assertFalse(module['cached_metadata']('audiodb','search',{'artist':'Artist','title':'Example'})[1])
   self.assertEqual(len(calls),2)
 def test_concurrent_misses_only_fetch_once(self):
  calls=[]
  def provider(*args):calls.append(args);return {'id':'456','title':'Example'}
  with patch.dict(g,{'fetch_provider':provider}):
   with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:module['cached_metadata']('sonovault','record',{'id':'456'}),range(4)))
  self.assertEqual(len(calls),1)
 def test_failed_responses_not_cached(self):
  def fail(*args):raise ValueError('Quota')
  with patch.dict(g,{'fetch_provider':fail}):
   with self.assertRaises(ValueError):module['cached_metadata']('sonovault','record',{'id':'9'})
  self.assertEqual(module['saved_records'](),[])
 def test_secret_config_not_public(self):
  Path(g['CONFIG_FILE']).write_text('SONOVAULT_API_KEY="test-secret-only"\n')
  with patch.dict(os.environ,{},clear=True):self.assertEqual(module['read_config']()['sonovault_api_key'],'test-secret-only')
  h=object.__new__(module['Handler'])
  for path in ['/.env', '/.env.example', '/change-history.json', '/config.json','/%63onfig.json','/metadata-cache.sqlite3','/../config.json','/.gitignore','/server.py']:
   self.assertTrue(h.translate_path(path).endswith('__blocked_path__'))
  self.assertTrue(h.translate_path('/').endswith('index.html'))
 def test_invalid_id_never_requests_provider(self):
  with self.assertRaises(ValueError):module['cached_metadata']('sonovault','record',{'id':'../1'})

if __name__=='__main__':unittest.main()
