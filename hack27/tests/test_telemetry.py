import os
import json
import tempfile
import unittest
from unittest.mock import patch

from planner.telemetry import log_job_telemetry
from planner.pipeline import run_pipeline
from planner.manim_run import RenderResult


class TestTelemetry(unittest.TestCase):
    def test_log_job_telemetry_file(self):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as f:
            temp_log = f.name

        try:
            log_job_telemetry(
                job_id="telemetry_test_1",
                prompt="test telemetry prompt",
                status="success",
                attempts=1,
                per_attempt=[{"attempt": 1, "stage": "rendering", "error_type": None, "duration_s": 2.1}],
                total_latency_s=2.5,
                error_type=None,
                token_usage={"total_tokens": 100},
                log_file=temp_log
            )

            with open(temp_log, "r", encoding="utf-8") as f:
                lines = f.readlines()

            self.assertEqual(len(lines), 1)
            record = json.loads(lines[0])
            self.assertEqual(record["job_id"], "telemetry_test_1")
            self.assertEqual(record["prompt"], "test telemetry prompt")
            self.assertEqual(record["status"], "success")
            self.assertEqual(record["attempts"], 1)
            self.assertEqual(record["token_usage"], {"total_tokens": 100})
            self.assertIn("timestamp", record)
        finally:
            if os.path.exists(temp_log):
                os.remove(temp_log)

    @patch("planner.pipeline.run_manim_script")
    @patch("planner.pipeline.generate_dsl")
    def test_pipeline_writes_telemetry(self, mock_gen, mock_render):
        valid_code = """from manim import *
class S(Scene):
    def construct(self):
        t = Text("Hello")
        self.play(FadeIn(t))
"""
        mock_gen.return_value = (valid_code, {"total_tokens": 42})
        mock_render.return_value = RenderResult(
            ok=True,
            video_path="static/videos/test.mp4",
            error_type=None,
            stderr_tail="",
            duration_s=1.0
        )

        with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as f:
            temp_log = f.name

        try:
            with patch("planner.telemetry._LOG_LOCK"):
                with patch("builtins.open", unittest.mock.mock_open()) as mock_file:
                    res = run_pipeline("test prompt", job_id="pipe_telem", max_attempts=1, log_telemetry=True)
                    self.assertTrue(res.ok)
        finally:
            if os.path.exists(temp_log):
                os.remove(temp_log)


if __name__ == "__main__":
    unittest.main()
