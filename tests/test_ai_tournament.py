import unittest
from unittest.mock import patch
import ai_tournament as t

class TournamentTests(unittest.TestCase):
    def test_catalog_filters(self):
        def model(name,price='0.0000001',tools=True):
            return {'id':name,'pricing':{'prompt':price,'completion':price},'architecture':{'input_modalities':['text'],'output_modalities':['text']},'supported_parameters':['tools'] if tools else [],'context_length':16000}
        catalog=[model('a/one'),model('openrouter/auto'),model('a/expensive','1'),model('a/no-tools',tools=False),model('a/bad','NaN')]
        self.assertEqual([m['id'] for m in t.eligible(catalog,1,4096,True)],['a/one'])
    def test_budget_fails_closed(self):
        for key in ({},{'limit_remaining':2},{'limit_remaining':1,'limit_reset':'daily','include_byok_in_limit':True}):
            with patch.object(t,'provider_get',return_value=key),self.assertRaises(ValueError):t.check_budget({},1,None)
        with patch.object(t,'provider_get',return_value={'limit_remaining':.5,'include_byok_in_limit':True,'limit_reset':None}):self.assertEqual(t.check_budget({},1,None),.5)
    def test_provisional_for_small_dataset(self):
        cases=[{'id':str(i),'artist':str(i),'expected_tags':[]} for i in range(7)]
        result={'cases':cases,'models':['a'],'results':[{'model':'a','id':c['id'],'f1':1,'seconds':1,'usage':{'cost':0}} for c in cases]}
        ranked=t.ranking(result,{'incumbent':'a','reviewed':True})
        self.assertIsNone(ranked['promote'])
        self.assertEqual(ranked['provisional_winner'],'a')
    def test_qualified_winner_and_holdout_gate(self):
        cases=[{'id':str(i),'artist':str(i),'expected_tags':[]} for i in range(20)]
        rows=[{'model':m,'id':c['id'],'f1':q,'seconds':1,'usage':{'cost':0}} for m,q in [('a',.7),('b',1)] for c in cases]
        result={'cases':cases,'models':['a','b'],'results':rows}
        ranked=t.ranking(result,{'incumbent':'a','reviewed':True})
        self.assertEqual(ranked['promote'],'b')
        for row in rows:
            if row['model']=='b' and row['id'] in ranked['holdout_ids']:row['f1']=0
        ranked=t.ranking(result,{'incumbent':'a','reviewed':True})
        self.assertEqual(ranked['provisional_winner'],'b')
        self.assertIsNone(ranked['promote'])
    def test_expired_plan(self):
        with self.assertRaises(ValueError):t.execute({'id':'missing'},{},'',None,lambda *args:None)
