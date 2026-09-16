import json
import os
import tempfile
import unittest
from unittest.mock import patch
import ai_tags

class AITests(unittest.TestCase):
    def test_unverified_candidate_is_preserved(self):
        result = ai_tags.parse_metadata(json.dumps({'tags': [], 'title': None, 'candidate': {'title': 'Silver And Gold', 'artists': ['Luciano'], 'album': 'Hard Times Riddim', 'year': 2004}}))
        self.assertEqual(result['title'], 'Silver And Gold')
        self.assertEqual(result['album'], 'Hard Times Riddim')
        self.assertTrue(result['conflicts'])
        with self.assertRaises(ValueError):
            ai_tags.parse_metadata(json.dumps({'tags': [], 'candidate': {'year': 'bad'}}))
    def test_schema(self):
        self.assertEqual(ai_tags.parse_tags('```json\n{"tags":[{"label":"House","confidence":0.8}]}\n```')[0]['label'],'House')
        for content in ['{"tags":[{"label":"x","confidence":true}]}','{"tags":[{"label":"x","confidence":NaN}]}','not json']:
            with self.assertRaises(ValueError): ai_tags.parse_tags(content)
    def test_metrics(self):
        result=ai_tags.score([{'label':' HOUSE ','confidence':0.8},{'label':'Pop','confidence':0.5}],['House','Dance'])
        self.assertEqual(result['f1'],0.5)
        self.assertAlmostEqual(result['brier'],0.145)
        self.assertEqual(ai_tags.score([],['House'])['f1'],0)
        self.assertEqual(ai_tags.score([],[])['f1'],1)
    def test_endpoint(self):
        for url in ['http://example.com','https://secret@example.com','https://example.com?key=secret']:
            with self.assertRaises(ValueError): ai_tags.endpoint(url)
        self.assertEqual(ai_tags.endpoint('https://openrouter.ai/api/v1'),'https://openrouter.ai/api/v1/chat/completions')
    def test_runs_continue_after_failures(self):
        cases=[{'id':str(i),'artist':'Artist','title':'Title','expected_tags':['House']} for i in range(3)]
        config={'ai_model':'test','ai_base_url':'https://example.com/v1','ai_api_key':'SECRET'}
        with tempfile.TemporaryDirectory() as root:
            path=os.path.join(root,'runs.json')
            def success(*args):return {'tags':[{'label':'House','confidence':0.8}]}
            first=ai_tags.run(config,cases,path,None,success)
            self.assertEqual(first['summary']['macro_f1'],1)
            def fail(*args):raise ValueError('Failed')
            second=ai_tags.run(config,cases,path,None,fail)
            self.assertEqual(len(second['results']),3)
            self.assertEqual(len(ai_tags.read_runs(path)),2)
            self.assertEqual(first['dataset_hash'],second['dataset_hash'])
            with open(path) as saved: self.assertNotIn('SECRET',saved.read())
    def test_labels_not_sent(self):
        case={'artist':'Artist','title':'Title','expected_tags':['SECRET_LABEL']}
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{"choices":[{"message":{"content":"{\\"tags\\":[]}"}}]}'
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.return_value=Reply()
            ai_tags.query({'ai_base_url':'https://example.com/v1','ai_model':'test','ai_api_key':''},case,None)
            payload=opener.return_value.open.call_args.args[0].data.decode()
            self.assertNotIn('SECRET_LABEL',payload)

class AlbumYearTests(unittest.TestCase):
    def test_capleton_album_aliases_and_year(self):
        case={'id':'capleton','artist':'Capleton','title':'Good in Her Clothes','expected_tags':None,
              'expected_albums':['Hotta Fire','Hotta Fire Riddim'],'expected_year':1999}
        ai_tags.validate_cases([case])
        for album in ('Hotta Fire',' hotta fire riddim '):
            self.assertEqual(ai_tags.score_metadata({'album':album,'year':1999},case),{'album_correct':True,'year_correct':True})
        self.assertEqual(ai_tags.score_metadata({'album':'Other','year':2000},case),{'album_correct':False,'year_correct':False})
        self.assertEqual(ai_tags.score_metadata({},case),{'album_correct':False,'year_correct':False})
        with tempfile.TemporaryDirectory() as root:
            result=ai_tags.run({'ai_model':'test','ai_base_url':'https://example.com/v1'},[case],os.path.join(root,'runs.json'),None,
                lambda *args: {'tags':[], 'album':'Hotta Fire','year':1999})
            self.assertIsNone(result['summary']['macro_f1'])
            self.assertTrue(result['results'][0]['album_correct'])
    def test_metadata_parse_and_validation(self):
        result=ai_tags.parse_metadata('{"tags":[],"album":"Hotta Fire","year":1999}')
        self.assertEqual(result['year'],1999)
        with self.assertRaises(ValueError): ai_tags.parse_metadata('{"tags":[],"year":true}')

class ProviderErrorTests(unittest.TestCase):
    def test_http_status_without_secret_body(self):
        from urllib.error import HTTPError
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.side_effect=HTTPError('https://secret',429,'SECRET',{},None)
            with self.assertRaisesRegex(ValueError,'HTTP 429: Provider rate limit') as caught:
                ai_tags.query({'ai_base_url':'https://example.com','ai_model':'x','ai_api_key':'SECRET'},{'artist':'A','title':'T'},None)
            self.assertNotIn('SECRET',str(caught.exception))
    def test_truncation_is_specific(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{"choices":[{"finish_reason":"length","message":{"content":"{"}}]}'
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.return_value=Reply()
            with self.assertRaisesRegex(ValueError,'truncated'):
                ai_tags.query({'ai_base_url':'https://example.com','ai_model':'x','ai_api_key':''},{'artist':'A','title':'T'},None)
    def test_success_after_failed_track(self):
        cases=[{'id':str(i),'artist':'A','title':'T','expected_tags':[]} for i in range(3)]
        calls=[]
        def request(config,case,context):
            calls.append(case['id'])
            if case['id']=='1':raise ValueError('Model did not return valid JSON.')
            return {'tags':[]}
        with tempfile.TemporaryDirectory() as root:
            result=ai_tags.run({'ai_base_url':'https://example.com','ai_model':'x'},cases,os.path.join(root,'runs.json'),None,request)
        self.assertEqual(calls,['0','1','2'])
        self.assertEqual(result['summary']['attempted'],3)
        self.assertEqual(result['summary']['completed'],2)
        self.assertEqual(result['summary']['failed'],1)

class TokenLimitTests(unittest.TestCase):
    def test_config_roundtrip_and_limits(self):
        import config_store
        with tempfile.TemporaryDirectory() as root:
            path=os.path.join(root,'.env')
            self.assertEqual(config_store.read(path)['ai_max_tokens'],4096)
            config_store.save(path,{'ai_max_tokens':8192})
            self.assertEqual(config_store.read(path)['ai_max_tokens'],8192)
            for invalid in (True,255,32769,4096.5,'4096'):
                with self.assertRaises(ValueError):config_store.save(path,{'ai_max_tokens':invalid})
    def test_request_uses_configured_limit(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{"choices":[{"message":{"content":"{\\"tags\\":[]}"}}]}'
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.return_value=Reply()
            config={'ai_base_url':'https://example.com','ai_model':'x','ai_api_key':''}
            for limit in (4096,8192):
                if limit==8192:config['ai_max_tokens']=limit
                ai_tags.query(config,{'artist':'A','title':'T'},None)
                self.assertEqual(json.loads(opener.return_value.open.call_args.args[0].data)['max_tokens'],limit)

class GroundingTests(unittest.TestCase):
    def test_aliases_and_optional_extras(self):
        tags=[{'label':'Rhythm and Blues','confidence':1},{'label':'Funk','confidence':1}]
        result=ai_tags.score(tags,['R&B'],['Funk'],{'R&B':['Rhythm and Blues']})
        self.assertEqual(result['f1'],1)
        self.assertEqual(result['unreviewed_tags'],[])
        self.assertEqual(ai_tags.score(tags,['R&B'],[],{'R&B':['Rhythm and Blues']})['unreviewed_tags'],['funk'])
    def test_sources_are_safe_and_provenance_preserved(self):
        sources=ai_tags.sources_from({'content':'{"sources":[{"url":"javascript:alert(1)"},{"url":"https://example.org/song"}]}',
            'annotations':[{'type':'url_citation','url_citation':{'url':'https://example.com/song','title':'Song'}}]})
        self.assertEqual(len(sources),2)
        self.assertEqual(sources[0]['origin'],'provider citation')
        self.assertEqual(sources[1]['origin'],'model supplied (unverified)')
    def test_search_request_and_reference_isolation(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{"choices":[{"message":{"content":"{\\"tags\\":[]}"}}]}'
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.return_value=Reply()
            result=ai_tags.query({'ai_base_url':'https://openrouter.ai/api/v1','ai_model':'test','ai_api_key':'','ai_web_search':True},
                {'artist':'A','title':'T','expected_tags':['HIDDEN'],'acceptable_tags':['SECRET'],'tag_aliases':{'SECRET':['HIDDEN']},'expected_year':1999},None)
            payload=json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertEqual(payload['tools'][0]['type'],'openrouter:web_search')
            self.assertEqual(payload['tools'][0]['parameters']['max_total_results'],3)
            self.assertNotIn('SECRET',json.dumps(payload))
            self.assertNotIn('1999',json.dumps(payload))
            self.assertIn('unverified',result['source_warning'])

class MultiModelTests(unittest.TestCase):
    def test_three_models_continue_and_score_independently(self):
        cases=[{'id':str(i),'artist':'A','title':'T','expected_tags':[]} for i in range(2)]
        calls=[]
        def request(config,case,context):
            calls.append((config['ai_model'],case['id']))
            if config['ai_model']=='bad':raise ValueError('Failed')
            return {'tags':[]}
        with tempfile.TemporaryDirectory() as root:
            result=ai_tags.run({'ai_base_url':'https://example.com','ai_model':'one','ai_model_2':'bad','ai_model_3':'three'},cases,os.path.join(root,'runs.json'),None,request)
        self.assertEqual(len(calls),6)
        self.assertEqual(result['summary']['total'],6)
        self.assertEqual(result['summary']['completed'],4)
        self.assertEqual([m['macro_f1'] for m in result['model_summaries']],[1,0,1])
        self.assertEqual(result['results'][-1]['model'],'three')
    def test_duplicate_slots_run_once(self):
        with tempfile.TemporaryDirectory() as root:
            result=ai_tags.run({'ai_base_url':'https://example.com','ai_model':'one','ai_model_2':' one ','ai_model_3':''},
                [{'id':'1','artist':'A','title':'T','expected_tags':[]}],os.path.join(root,'runs.json'),None,lambda *args:{'tags':[]})
        self.assertEqual(result['models'],['one'])
        self.assertEqual(len(result['results']),1)

class TimeoutTests(unittest.TestCase):
    def test_settings_roundtrip(self):
        import config_store
        with tempfile.TemporaryDirectory() as root:
            path=os.path.join(root,'.env')
            self.assertEqual(config_store.read(path)['ai_timeout_seconds'],120)
            config_store.save(path,{'ai_timeout_seconds':180})
            self.assertEqual(config_store.read(path)['ai_timeout_seconds'],180)
            for value in (True,14,301,30.5,'120'):
                with self.assertRaises(ValueError):config_store.save(path,{'ai_timeout_seconds':value})
    def test_timeout_no_retry(self):
        for limit in (120,180):
            config={'ai_base_url':'https://example.com','ai_model':'test','ai_api_key':''}
            if limit==180:config['ai_timeout_seconds']=limit
            with patch('ai_tags.build_opener') as opener:
                opener.return_value.open.side_effect=TimeoutError()
                with self.assertRaisesRegex(ValueError,str(limit)+' seconds'):
                    ai_tags.query(config,{'artist':'A','title':'T'},None)
                self.assertEqual(opener.return_value.open.call_count,1)
                self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'],limit)

class JSONOutputTests(unittest.TestCase):
    def test_commentary_and_fences(self):
        for content in ('Here is the result:\n{"tags":[],"year":1999}\nDone.', '```JSON\n{"tags":[]}\n```'):
            self.assertEqual(ai_tags.parse_metadata(content)['tags'],[])
    def test_ambiguous_and_malformed_rejected(self):
        for content in ('{"tags":[]} {"tags":[]}', '{"tags":[],"tags":[]}', '{"broken": {"tags":[]}', '[{"tags":[]}]', "{'tags': []}"):
            with self.assertRaises(ValueError):ai_tags.parse_metadata(content)
    def test_default_json_compatibility_no_retry(self):
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.side_effect=TimeoutError()
            with self.assertRaises(ValueError):
                ai_tags.query({'ai_base_url':'https://openrouter.ai/api/v1','ai_model':'openrouter/auto-beta','ai_api_key':''},{'artist':'A','title':'T'},None)
            payload=json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertNotIn('response_format',payload)
            self.assertNotIn('provider',payload)
            self.assertEqual(opener.return_value.open.call_count,1)

class OptionalJSONTests(unittest.TestCase):
    def test_optional_json_without_routing_restriction(self):
        with patch('ai_tags.build_opener') as opener:
            opener.return_value.open.side_effect=TimeoutError()
            with self.assertRaises(ValueError):
                ai_tags.query({'ai_base_url':'https://openrouter.ai/api/v1','ai_model':'test','ai_api_key':'','ai_json_mode':True},{'artist':'A','title':'T'},None)
            payload=json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertEqual(payload['response_format'],{'type':'json_object'})
            self.assertNotIn('provider',payload)
            self.assertEqual(opener.return_value.open.call_count,1)

class IdentitySuggestionTests(unittest.TestCase):
    def test_optional_identity(self):
        import ai_tags
        value=ai_tags.parse_metadata('{"tags":[],"title":" Song ","artists":["Artist","Guest"]}')
        self.assertEqual(value['title'],'Song')
        self.assertEqual(value['artists'],['Artist','Guest'])
        self.assertIsNone(ai_tags.parse_metadata('{"tags":[]}')['title'])
        for extra in ({'title':12},{'artists':'Artist'},{'artists':['']}):
            with self.assertRaises(ValueError):ai_tags.parse_metadata(json.dumps({'tags':[],**extra}))

class RecordLabelTests(unittest.TestCase):
    def test_label_validation(self):
        import ai_tags
        self.assertEqual(ai_tags.parse_metadata('{"tags":[],"label":" Columbia "}')['label'],'Columbia')
        self.assertIsNone(ai_tags.parse_metadata('{"tags":[]}')['label'])
        for label in (123, [], '', 'x'*301):
            with self.assertRaises(ValueError):ai_tags.parse_metadata(json.dumps({'tags':[],'label':label}))
