import pathlib, runpy, unittest

module=runpy.run_path(str(pathlib.Path(__file__).parents[1]/'server.py'))

class LocalWriteTests(unittest.TestCase):
 def handler(self, origin, content_type='application/json', host='127.0.0.1:8765'):
  handler=object.__new__(module['Handler'])
  handler.headers={'Host':host,'Origin':origin,'Content-Type':content_type}
  handler.send_json=lambda data,status=200:setattr(handler,'rejection',status)
  return handler
 def test_browser_origin_required(self):
  for origin in ('https://unrelated.example','null',''):
   h=self.handler(origin);self.assertFalse(h.allow_local_write());self.assertEqual(h.rejection,403)
  self.assertFalse(self.handler('http://127.0.0.1:8765','text/plain').allow_local_write())
  self.assertTrue(self.handler('http://127.0.0.1:8765').allow_local_write())
  self.assertFalse(self.handler('http://evil.example','application/json','evil.example').allow_local_write())
 def test_private_files_not_served(self):
  h=object.__new__(module['Handler'])
  for path in ('/.env','/%2eenv','/.env.example','/config.json','/change-history.json','/metadata-cache.sqlite3','/config_store.py'):
   self.assertTrue(h.translate_path(path).endswith('__blocked_path__'))

if __name__=='__main__':unittest.main()
