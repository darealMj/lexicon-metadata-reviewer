import unittest
from unittest.mock import patch
import wikipedia_source as w

HTML='''<table class="infobox"><tr><th>Crazy in Love</th></tr><tr><td>Single by Beyoncé featuring Jay-Z</td></tr><tr><td>from the album Dangerously in Love</td></tr><tr><th>Genre</th><td><ul><li>Pop</li><li>R&amp;B<sup>[1]</sup></li></ul></td></tr><tr><th>Released</th><td>May 18, 2003</td></tr></table>'''
class WikipediaTests(unittest.TestCase):
 def test_fields_and_reference_removal(self):
  fields=w.extract(HTML,'Crazy in Love','Beyoncé','Crazy in Love')
  self.assertEqual(fields['genre'],'Pop | R&B')
  self.assertEqual(fields['album'],'Dangerously in Love')
  self.assertEqual(fields['released'],'May 18, 2003')
 def test_wrong_identity(self):
  self.assertIsNone(w.extract(HTML,'Crazy in Love','Other Artist','Crazy in Love'))
  self.assertIsNone(w.extract(HTML,'Dangerously in Love','Beyoncé','Crazy in Love'))
  self.assertIsNone(w.extract(HTML.replace('Single by','Album by'),'Crazy in Love','Beyoncé','Crazy in Love'))
 def test_remix_never_uses_original(self):
  with patch.object(w,'api') as api:
   self.assertEqual(w.lookup('Beyoncé','Crazy in Love (Remix)',None)['status'],'skipped');api.assert_not_called()
 def test_ambiguous_and_failure(self):
  search={'query':{'search':[{'title':'Crazy in Love','pageid':1},{'title':'Crazy in Love (song)','pageid':2}]}}
  page={'parse':{'text':HTML,'title':'Crazy in Love','revid':1}}
  with patch.object(w,'api',side_effect=[search,page,page]):self.assertEqual(w.lookup('Beyoncé','Crazy in Love',None)['status'],'unresolved')
  with patch.object(w,'api',side_effect=OSError):self.assertEqual(w.lookup('Beyoncé','Crazy in Love',None)['status'],'unavailable')
