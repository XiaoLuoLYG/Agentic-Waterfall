import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('mars_controller_under_test',Path(__file__).with_name('run.py'))
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class BoundaryTest(unittest.TestCase):
    def test_input_drift_is_rejected_before_starting_paid_runner(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'input.json';source.write_text('{"observation":"original"}')
            row={'id':'offline-drift-check','input':str(source),'input_sha256':runner.sha(source)}
            source.write_text('{"observation":"changed"}')
            with patch.object(runner.subprocess,'run') as execute:
                with self.assertRaisesRegex(AssertionError,'before inference'):
                    runner.run_case(row,{})
                execute.assert_not_called()

if __name__=='__main__':unittest.main()
