"""JSONL service: cache only loaders; call the untouched original semantic.score."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
METHOD = ROOT / 'methods/agentic-waterfall'
EXPECTED = {
    'recbot/semantic.py': '1ff4268e880bdd6487861a71f94e1d6a8f5254918a076a507241abeb5359afb7',
    'fixed-retrieval/retrieval.py': '957633d28c34aa267dea3b59f70744e16cfba82196c150b9724d978fc93da4a4',
}


def main():
    started = time.perf_counter()
    for name, digest in EXPECTED.items():
        assert hashlib.sha256((METHOD / name).read_bytes()).hexdigest() == digest, name
    sys.path.insert(0, str(METHOD / 'fixed-retrieval'))
    sys.path.insert(0, str(ROOT / 'output/agentic-waterfall/full-expansion-20261030/runtime/formal'))
    from gpu_lock import locked
    import retrieval
    spec = importlib.util.spec_from_file_location('recbot_original_semantic', METHOD / 'recbot/semantic.py')
    semantic = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(semantic)
    assert semantic.embeddings is retrieval.embeddings
    original_models = retrieval.models
    with locked():
        torch, tokenizer_cls, model_cls, sequence_cls, device = original_models()
        weights = METHOD / 'fixed-retrieval/weights/bge-m3'
        tokenizer = tokenizer_cls.from_pretrained(weights, local_files_only=True)
        model = model_cls.from_pretrained(weights, local_files_only=True).to(device).eval()
        assert all(p.dtype == torch.float32 for p in model.parameters() if p.is_floating_point())

        class TokenizerLoader:
            @staticmethod
            def from_pretrained(path, **kwargs):
                assert Path(path).resolve() == weights.resolve() and kwargs == {'local_files_only': True}
                return tokenizer

        class ModelLoader:
            @staticmethod
            def from_pretrained(path, **kwargs):
                assert Path(path).resolve() == weights.resolve() and kwargs == {'local_files_only': True}
                return model

        def cached_models():
            current = original_models()
            assert current[0] is torch and current[4] == device
            return torch, TokenizerLoader, ModelLoader, sequence_cls, device

        retrieval.models = cached_models
        emit({'type': 'ready', 'device': device, 'dtype': str(next(model.parameters()).dtype),
              'threads': torch.get_num_threads(), 'startup_seconds': time.perf_counter() - started,
              'source_sha256': EXPECTED, 'original_embeddings_function_unchanged': True})
        for line in sys.stdin:
            request = json.loads(line)
            assert isinstance(request.get('id'), str) and isinstance(request.get('payload'), dict)
            before = time.perf_counter()
            scores = semantic.score(request['payload'])
            emit({'type': 'result', 'id': request['id'], 'scores': scores,
                  'seconds': time.perf_counter() - before})


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
