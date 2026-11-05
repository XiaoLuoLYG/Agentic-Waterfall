"""Execute worker routing/device guards with fakes; never load weights or call a model."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

WORKER=Path(sys.argv.pop(1)).resolve() if len(sys.argv)>1 else Path(__file__).with_name('fixed-worker.py')
OUT=Path(__file__).resolve().parent.parent

class WorkerTests(unittest.TestCase):
    def execute(self,device='mps',parameter_device='mps',tokens=100,callback=None):
        dtype='torch.float32'
        torch=types.SimpleNamespace(float32=dtype,backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda:True)),
            nn=types.SimpleNamespace(functional=types.SimpleNamespace(scaled_dot_product_attention=None)),
            set_num_threads=lambda _:None,set_num_interop_threads=lambda _:None,
            mps=types.SimpleNamespace(current_allocated_memory=lambda:0,driver_allocated_memory=lambda:0))
        class Model:
            def parameters(self):return iter([types.SimpleNamespace(device=types.SimpleNamespace(type=parameter_device),dtype=dtype)])
            def register_forward_pre_hook(self,fn):self.hook=fn
            def forward(self):self.hook(self,())
        factory=types.SimpleNamespace(from_pretrained=lambda *a,**k:Model())
        retrieval=types.SimpleNamespace(models=lambda:(torch,None,factory,factory,'mps'),
            reranker_inputs=lambda *a,**k:({'input_ids':types.SimpleNamespace(shape=(1,tokens))},[{'model_input_sha256':'fixture'}]))
        locks=[]
        @contextlib.contextmanager
        def locked():
            locks.append('enter')
            try:yield
            finally:locks.append('exit')
        with tempfile.TemporaryDirectory(prefix='fixed-worker-test-',dir=OUT) as folder:
            output=Path(folder)/'case'
            def main():
                self.assertEqual(retrieval.models()[-1],'mps')
                retrieval.models()[2].from_pretrained('fixture').forward()
                retrieval.reranker_inputs()
                output.mkdir()
            modules={'torch':torch,'gpu_attention':types.SimpleNamespace(gpu_attention=lambda *a:None,STATS={}),
                'retrieval':retrieval,'kuairec_batch':types.SimpleNamespace(main=main),
                'gpu_lock':types.SimpleNamespace(locked=locked)}
            with patch.dict(sys.modules,modules),patch.object(sys,'argv',[str(WORKER),device,'--output',str(output)]),contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(WORKER),run_name='__main__')
            receipt=json.loads(output.with_suffix('.runtime.json').read_text())
            self.assertEqual(locks,['enter','exit'])
            self.assertEqual(receipt['device'],'mps');self.assertFalse(receipt['cpu_fallback'])
            self.assertEqual(receipt['inference_device_verified'],'mps');self.assertEqual(receipt['exit_code'],0)
            self.assertEqual(receipt['model_api_calls'],0);self.assertFalse(receipt['training']);self.assertFalse(receipt['labels_read'])
            self.assertEqual(receipt['loaded_models'][0]['path'],'fixture')
            if callback:callback(receipt)

    def test_new_scope_executes_frozen_pipeline_and_writes_receipt(self):self.execute()
    def test_cpu_route_is_rejected_before_inference(self):
        with self.assertRaisesRegex(AssertionError,'CPU model inference'):self.execute(device='cpu')
    def test_cpu_model_is_rejected_at_forward(self):
        with self.assertRaises(AssertionError):self.execute(parameter_device='cpu')
    def test_above_native_capacity_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'native model capacity'):self.execute(tokens=8193)

if __name__=='__main__':unittest.main()
