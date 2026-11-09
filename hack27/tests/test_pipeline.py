import unittest
from unittest.mock import patch
from planner.pipeline import run_pipeline, PipelineResult
from planner.manim_run import RenderResult


class TestPipelineLoop(unittest.TestCase):
    @patch("planner.pipeline.run_manim_script")
    @patch("planner.pipeline.generate_dsl")
    def test_pipeline_first_try_success(self, mock_gen, mock_render):
        valid_code = """from manim import *
class S(Scene):
    def construct(self):
        t = Text("Hello")
        self.play(FadeIn(t))
"""
        mock_gen.return_value = (valid_code, {"total_tokens": 50})
        mock_render.return_value = RenderResult(
            ok=True,
            video_path="static/videos/test.mp4",
            error_type=None,
            stderr_tail="",
            duration_s=2.5
        )

        res = run_pipeline("test prompt", job_id="test1", max_attempts=3, log_telemetry=False)
        self.assertTrue(res.ok)
        self.assertEqual(res.attempts, 1)
        self.assertEqual(len(res.outcomes), 1)
        self.assertEqual(res.outcomes[0].stage, "rendering")
        self.assertIsNone(res.outcomes[0].error_type)

    @patch("planner.pipeline.run_manim_script")
    @patch("planner.pipeline.repair_dsl")
    @patch("planner.pipeline.generate_dsl")
    def test_pipeline_validator_failure_then_repair_success(self, mock_gen, mock_repair, mock_render):
        bad_code = """from manim import *
class S(Scene):
    def construct(self):
        t = MathTex("x^2")
        self.play(FadeIn(t))
"""
        good_code = """from manim import *
class S(Scene):
    def construct(self):
        t = Text("x^2")
        self.play(FadeIn(t))
"""
        mock_gen.return_value = (bad_code, {"total_tokens": 40})
        mock_repair.return_value = (good_code, {"total_tokens": 60})
        mock_render.return_value = RenderResult(
            ok=True,
            video_path="static/videos/test.mp4",
            error_type=None,
            stderr_tail="",
            duration_s=2.0
        )

        res = run_pipeline("test prompt", job_id="test2", max_attempts=3, log_telemetry=False)
        self.assertTrue(res.ok)
        self.assertEqual(res.attempts, 2)
        self.assertEqual(len(res.outcomes), 2)
        self.assertEqual(res.outcomes[0].stage, "validation")
        self.assertEqual(res.outcomes[0].error_type, "validation")
        self.assertEqual(res.outcomes[1].stage, "rendering")
        self.assertIsNone(res.outcomes[1].error_type)
        mock_repair.assert_called_once()

    @patch("planner.pipeline.run_manim_script")
    @patch("planner.pipeline.repair_dsl")
    @patch("planner.pipeline.generate_dsl")
    def test_pipeline_render_failure_then_repair_success(self, mock_gen, mock_repair, mock_render):
        code = """from manim import *
class S(Scene):
    def construct(self):
        t = Text("Hello")
        self.play(FadeIn(t))
"""
        mock_gen.return_value = (code, {"total_tokens": 40})
        mock_repair.return_value = (code, {"total_tokens": 40})
        mock_render.side_effect = [
            RenderResult(ok=False, video_path=None, error_type="manim_error", stderr_tail="AttributeError: foo", duration_s=1.0),
            RenderResult(ok=True, video_path="static/videos/test.mp4", error_type=None, stderr_tail="", duration_s=1.5),
        ]

        res = run_pipeline("test prompt", job_id="test3", max_attempts=3, log_telemetry=False)
        self.assertTrue(res.ok)
        self.assertEqual(res.attempts, 2)
        self.assertEqual(res.outcomes[0].error_type, "manim_error")
        self.assertIsNone(res.outcomes[1].error_type)


if __name__ == "__main__":
    unittest.main()
