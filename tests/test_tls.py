import os
from pathlib import Path
import runpy
import ssl
import unittest
from unittest.mock import Mock, patch

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'server.py'))
create_context = module['create_https_context']


class HTTPSContextTests(unittest.TestCase):
    def test_real_context_requires_verification(self):
        context = create_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_empty_macos_store_loads_os_bundle(self):
        context = Mock()
        context.cert_store_stats.return_value = {'x509_ca': 0}
        with patch('ssl.create_default_context', return_value=context), \
                patch('sys.platform', 'darwin'), \
                patch.dict(os.environ, {}, clear=True), \
                patch('os.path.isfile', return_value=True):
            self.assertIs(create_context(), context)
        context.load_verify_locations.assert_called_once_with(cafile='/etc/ssl/cert.pem')

    def test_existing_or_explicit_trust_store_is_preserved(self):
        for roots, env in [(128, {}), (0, {'SSL_CERT_FILE': '/custom/ca.pem'}),
                           (0, {'SSL_CERT_DIR': '/custom/certs'})]:
            with self.subTest(roots=roots, env=env):
                context = Mock()
                context.cert_store_stats.return_value = {'x509_ca': roots}
                with patch('ssl.create_default_context', return_value=context), \
                        patch('sys.platform', 'darwin'), \
                        patch.dict(os.environ, env, clear=True):
                    create_context()
                context.load_verify_locations.assert_not_called()


if __name__ == '__main__':
    unittest.main()
