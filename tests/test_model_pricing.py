import unittest
from unittest.mock import patch
import model_pricing as p
class PricingTests(unittest.TestCase):
 def test_units_and_missing(self):
  data=p.normalize([{'id':'test','pricing':{'prompt':'0.00000002','completion':'0.0000001'}},{'id':'missing'}])
  self.assertAlmostEqual(data['test']['input'],.02)
  self.assertAlmostEqual(data['test']['output'],.1)
  self.assertIsNone(data['missing']['input'])
  for value in (None,'NaN','-1','invalid','Infinity'):self.assertIsNone(p.price(value))
  self.assertEqual(p.price('0'),0)
 def test_failure_not_zero_price(self):
  with patch.object(p,'CACHE',None),patch.object(p,'urlopen',side_effect=OSError):
   result=p.catalog(None)
   self.assertEqual(result['models'],{})
   self.assertIn('error',result)
