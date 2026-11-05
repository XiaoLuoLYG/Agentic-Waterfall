"""Serialize local embedding and reranking processes in this isolated run."""
import fcntl
from contextlib import contextmanager
from pathlib import Path

@contextmanager
def locked():
    with (Path(__file__).parent/'gpu.lock').open('a') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        try:yield
        finally:fcntl.flock(f,fcntl.LOCK_UN)
