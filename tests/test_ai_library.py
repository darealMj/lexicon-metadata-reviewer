import unittest,tempfile,sqlite3,os
from unittest.mock import patch
import ai_library as lib

DATA={'data':{'categories':[{'id':1,'label':'Genre'},{'id':2,'label':'Subgenre'},{'id':3,'label':'Mood'}],
 'tags':[{'id':1,'categoryId':1,'label':'Reggae'},{'id':2,'categoryId':2,'label':'Roots Reggae'},{'id':3,'categoryId':3,'label':'Happy'},{'id':4,'categoryId':1,'label':'R&B/Soul/Funk'}]}}
class LibraryTests(unittest.TestCase):
 def test_subgenre_not_main(self):
  result=lib.constrain({'main_genre':'Roots Reggae','tags':[{'label':'Roots Reggae','confidence':.8},{'label':'Invented','confidence':.9}]},lib.taxonomy(DATA))
  self.assertIsNone(result['main_genre'])
  self.assertEqual(result['categorized_tags'][0]['category'],'Subgenre')
  self.assertEqual(len(result['categorized_tags']),1)
 def test_compound_and_apply_validation(self):
  result=lib.constrain({'main_genre':'r&b/soul/funk','tags':[]},lib.taxonomy(DATA))
  self.assertEqual(result['main_genre'],'R&B/Soul/Funk')
  lib.validate_apply({'genre':'Reggae'},{'genre':True,'tags':[{'id':2,'categoryId':2,'label':'Roots Reggae'}]},DATA)
  with self.assertRaises(ValueError):lib.validate_apply({'genre':'Roots Reggae'},{'genre':True},DATA)
  with self.assertRaises(ValueError):lib.validate_apply({}, {'tags':[{'id':2,'categoryId':1,'label':'Roots Reggae'}]},DATA)
 def test_cache_and_settings_invalidation(self):
  config={'ai_model':'test','ai_base_url':'https://openrouter.ai/api/v1','ai_max_tokens':4096,'ai_web_search':True}
  with tempfile.TemporaryDirectory() as root:
   def connection():
    db=sqlite3.connect(os.path.join(root,'cache.db'));db.execute('CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY,body TEXT,saved_at REAL)');return db
   with patch('ai_library.ai_tags.query',return_value={'main_genre':'Reggae','tags':[]}) as query:
    first=lib.lookup(config,{'artist':'A','title':'T'},DATA,connection,None)
    second=lib.lookup(config,{'artist':'A','title':'T'},DATA,connection,None)
    self.assertFalse(first['cached']);self.assertTrue(second['cached']);self.assertEqual(query.call_count,1)
    lib.lookup({**config,'ai_model':'other'},{'artist':'A','title':'T'},DATA,connection,None)
    self.assertEqual(query.call_count,2)
    self.assertIn('Genre',query.call_args.args[0]['ai_extra_prompt'])
