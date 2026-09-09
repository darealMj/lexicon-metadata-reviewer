import copy, pathlib, runpy, tempfile, unittest
from unittest.mock import patch

h = runpy.run_path(str(pathlib.Path(__file__).parents[1] / 'change_history.py'))

class HistoryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.path=str(pathlib.Path(self.tmp.name)/'history.json')
  self.track={'id':1,'title':'Original','genre':'Pop','tags':[1,2],'location':'/music/original.mp3'};self.writes=[]
 def get(self,tid):self.assertEqual(tid,1);return copy.deepcopy(self.track)
 def write(self,tid,edits):self.writes.append(edits);self.track.update(copy.deepcopy(edits))
 def apply(self,edits):return h['apply'](self.path,1,edits,self.get,self.write)
 def test_three_changes_and_restore_after_rename(self):
  for title in ['One','Two','Three','Four']:self.apply({'title':title})
  entries=h['read'](self.path);self.assertEqual(len(entries),3)
  self.track['location']='/music/renamed.mp3'
  h['restore'](self.path,entries[-1]['id'],self.get,self.write)
  self.assertEqual(self.track['title'],'Three');self.assertEqual(self.track['location'],'/music/renamed.mp3')
  last=h['read'](self.path)[-1];self.assertEqual(last['before']['filename'],'original.mp3');self.assertEqual(last['restore_before']['filename'],'renamed.mp3')
  h['restore'](self.path,entries[-2]['id'],self.get,self.write);self.assertEqual(self.track['title'],'Two')
 def test_conflict_and_restore_order(self):
  self.apply({'title':'One'});self.apply({'title':'Two'})
  entries=h['read'](self.path)
  with self.assertRaises(ValueError):h['restore'](self.path,entries[0]['id'],self.get,self.write)
  self.track['title']='External'
  with self.assertRaises(ValueError):h['restore'](self.path,entries[1]['id'],self.get,self.write)
  self.assertEqual(len(self.writes),2)
 def test_backup_failure_prevents_write(self):
  with patch.dict(h['apply'].__globals__,{'save':lambda *a:(_ for _ in ()).throw(OSError('disk full'))}):
   with self.assertRaises(OSError):self.apply({'title':'New'})
  self.assertEqual(self.writes,[])
 def test_uncertain_write_keeps_original_and_blocks_retry(self):
  def fail(*args):raise OSError('timeout')
  with self.assertRaises(OSError):h['apply'](self.path,1,{'title':'New'},self.get,fail)
  entry=h['read'](self.path)[0];self.assertEqual(entry['status'],'pending');self.assertEqual(entry['before']['fields']['title'],'Original')
  with self.assertRaises(ValueError):self.apply({'title':'Retry'})
 def test_tags_restore_preserves_unrelated_fields(self):
  self.apply({'tags':[3,4]});self.track['genre']='External genre'
  h['restore'](self.path,h['read'](self.path)[0]['id'],self.get,self.write)
  self.assertEqual(self.track['tags'],[1,2]);self.assertEqual(self.track['genre'],'External genre')
 def test_noop_and_missing_field(self):
  self.assertTrue(self.apply({'title':'Original'})['unchanged']);self.assertEqual(h['read'](self.path),[])
  with self.assertRaises(ValueError):self.apply({'label':'Missing original'})
  self.assertEqual(self.writes,[])

if __name__=='__main__':unittest.main()
