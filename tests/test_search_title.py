import unittest
from search_title import search_metadata

class SearchTitleTests(unittest.TestCase):
    def test_edits(self):
        for title in ('Song (Super Clean)', 'Song (Intro Clean)', 'Song [Dirty]', 'Song - Raw', 'Song Clean Extended', 'Song (Instrumental)'):
            result=search_metadata('Artist',title)
            self.assertEqual(result['title'],'Song')
            self.assertEqual(result['original_title'],title)
            self.assertTrue(result['version_markers'])
    def test_identity_preserved(self):
        for title in ('Dirty Diana','Clean','Raw','Song (Guest Remix)','Song feat. Guest','Song (Clean Remix)'):
            self.assertEqual(search_metadata('Artist',title),{'artist':'Artist','title':title})
    def test_remix_with_clean_marker(self):
        self.assertEqual(search_metadata('A','Song (Guest Remix) (Clean)')['title'],'Song (Guest Remix)')
