import unittest,tempfile,sqlite3,os,json
from unittest.mock import patch,MagicMock
import discogs_source as d

TAGS={'categories':[{'id':1,'label':'Genre'},{'id':2,'label':'Subgenre'}],'tags':[{'id':10,'categoryId':1,'label':'Reggae'},{'id':20,'categoryId':2,'label':'Dancehall'}]}
class DiscogsTests(unittest.TestCase):
 def test_mapping_and_identity(self):
  release={'id':1,'title':'Album','year':1999,'genres':['Reggae'],'styles':['Dancehall','Unknown'],'artists':[{'name':'Artist'}],'tracklist':[{'title':'Song'}],'labels':[{'name':'Label'}]}
  result=d.release_result(release,'Artist','Song (Clean)',TAGS)
  self.assertEqual(result['main_genre'],'Reggae')
  self.assertEqual([t['id'] for t in result['categorized_tags']],[10,20])
  self.assertEqual(result['title'],'Song')
  self.assertTrue(any('Unknown' in w for w in result['warnings']))
  result=d.release_result(release,'Artist','Different Song',TAGS)
  self.assertIsNone(result['title']);self.assertEqual(result['artists'],[])
 def test_cache_and_no_token_leak(self):
  with tempfile.TemporaryDirectory() as root:
   def connection():
    db=sqlite3.connect(os.path.join(root,'cache'));db.execute('CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY,body TEXT,saved_at REAL)');return db
   with patch.object(d,'build_opener') as opener:
    opener.return_value.open.return_value.__enter__.return_value.read.return_value=b'{"results":[]}'
    params={'artist':'A','title':'Song (Clean)','id':''}
    d.fetch('search',params,'secret',None,connection)
    request=opener.return_value.open.call_args.args[0]
    self.assertNotIn('secret',request.full_url)
    self.assertIn('track=Song',request.full_url)
    d.fetch('search',params,'',None,connection)
    self.assertEqual(opener.return_value.open.call_count,1)
    with self.assertRaisesRegex(ValueError,'token'):d.fetch('search',{**params,'title':'Other'},'',None,connection)
 def test_bad_id(self):
  with self.assertRaises(ValueError):d.fetch('record',{'id':'../foo'},'',None,None)

class DiscogsArtistTests(unittest.TestCase):
 def test_featured_credit_search(self):
  self.assertEqual(d.search_artist('Major Lazer ft Justin Bieber & MO'),'Major Lazer')
  self.assertEqual(d.search_artist('Artist feat. Guest'),'Artist')
  self.assertEqual(d.search_artist('Earth, Wind & Fire'),'Earth, Wind & Fire')
