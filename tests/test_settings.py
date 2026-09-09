import json, os, pathlib, runpy, tempfile, unittest
from unittest.mock import patch

module = runpy.run_path(str(pathlib.Path(__file__).parents[1] / 'config_store.py'))

class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = str(pathlib.Path(self.tmp.name) / '.env')
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start(); self.addCleanup(self.environment.stop)

    def test_first_run_and_defaults(self):
        config = module['read'](self.path)
        self.assertEqual(config['theme'], 'system')
        self.assertEqual(config['sonovault_api_key'], '')
        self.assertFalse(config['overwrite_custom_tags'])
        self.assertEqual(pathlib.Path(self.path).stat().st_mode & 0o777, 0o600)
        before = pathlib.Path(self.path).read_text()
        module['ensure'](self.path)
        self.assertEqual(pathlib.Path(self.path).read_text(), before)

    def test_legacy_migration_preserves_keys(self):
        legacy = pathlib.Path(self.tmp.name) / 'config.json'
        legacy.write_text(json.dumps({'sonovault_api_key':'test-secret', 'theme':'dark', 'advanced_mode':True}))
        config = module['read'](self.path)
        self.assertEqual(config['sonovault_api_key'], 'test-secret')
        self.assertEqual(config['theme'], 'dark')
        self.assertTrue(config['advanced_mode'])
        self.assertTrue(legacy.exists())

    def test_save_preserves_keys_and_validates(self):
        module['save'](self.path, {'sonovault_api_key':'test-secret', 'theme':'light'})
        module['save'](self.path, {'advanced_mode':True})
        config = module['read'](self.path)
        self.assertEqual(config['sonovault_api_key'], 'test-secret')
        self.assertEqual(config['theme'], 'light')
        self.assertTrue(config['advanced_mode'])
        before = pathlib.Path(self.path).read_text()
        for invalid in ({'advanced_mode':'false'}, {'unknown':True}, {'theme':'invalid'}, []):
            with self.assertRaises(ValueError): module['save'](self.path, invalid)
        self.assertEqual(pathlib.Path(self.path).read_text(), before)

    def test_special_characters_are_data(self):
        secret = 'test # $HOME $(no-execution) "quoted" \\ backslash'
        module['save'](self.path, {'sonovault_api_key':secret})
        self.assertEqual(module['read'](self.path)['sonovault_api_key'], secret)
        with patch.dict(os.environ, {'SONOVAULT_API_KEY':'override'}):
            self.assertEqual(module['read'](self.path)['sonovault_api_key'], 'override')
        self.assertEqual(module['read'](self.path)['sonovault_api_key'], secret)

    def test_invalid_env_does_not_expose_value(self):
        pathlib.Path(self.path).write_text('SONOVAULT_API_KEY="private-unclosed\n')
        with self.assertRaises(ValueError) as error: module['read'](self.path)
        self.assertNotIn('private-unclosed', str(error.exception))

if __name__ == '__main__': unittest.main()
