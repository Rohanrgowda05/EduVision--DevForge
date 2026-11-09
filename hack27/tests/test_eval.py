import os
import json
import tempfile
import unittest

from eval.llm_cache import (
    get_cached_response,
    save_cached_response,
    _compute_cache_key
)
from eval.run_eval import generate_csv, generate_summary, load_completed_results


class TestEvalHarness(unittest.TestCase):
    def test_llm_cache_save_and_retrieve(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sys_prompt = "system instructions"
            user_prompt = "test prompt"
            code = "from manim import *\nclass S(Scene):\n    pass\n"
            usage = {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30}

            # Initially empty
            self.assertIsNone(get_cached_response(sys_prompt, user_prompt, cache_dir=temp_dir))

            # Save
            save_cached_response(sys_prompt, user_prompt, code, usage, cache_dir=temp_dir)

            # Retrieve
            retrieved = get_cached_response(sys_prompt, user_prompt, cache_dir=temp_dir)
            self.assertIsNotNone(retrieved)
            self.assertEqual(retrieved[0], code)
            self.assertEqual(retrieved[1], usage)

    def test_summary_and_csv_generation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            csv_path = os.path.join(temp_dir, "results.csv")
            summary_path = os.path.join(temp_dir, "summary.md")

            mock_results = [
                {
                    "id": "p01",
                    "topic": "Topic A",
                    "category": "physics",
                    "difficulty": "normal",
                    "baseline": {"ok": True, "error_type": None, "duration_s": 3.0},
                    "full": {"ok": True, "first_try_ok": True, "attempts": 1, "error_type": None, "duration_s": 3.0}
                },
                {
                    "id": "p02",
                    "topic": "Topic B",
                    "category": "math",
                    "difficulty": "hard",
                    "baseline": {"ok": False, "error_type": "manim_error", "duration_s": 2.0},
                    "full": {"ok": True, "first_try_ok": False, "attempts": 2, "error_type": None, "duration_s": 5.0}
                },
                {
                    "id": "p03",
                    "topic": "Topic C",
                    "category": "cs",
                    "difficulty": "hard",
                    "baseline": {"ok": False, "error_type": "validation", "duration_s": 0.1},
                    "full": {"ok": False, "first_try_ok": False, "attempts": 3, "error_type": "timeout", "duration_s": 12.0}
                }
            ]

            generate_csv(mock_results, csv_path)
            self.assertTrue(os.path.exists(csv_path))
            with open(csv_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            self.assertEqual(len(lines), 4)  # header + 3 rows

            generate_summary(mock_results, summary_path, "eval/prompts_small.json")
            self.assertTrue(os.path.exists(summary_path))
            with open(summary_path, "r", encoding="utf-8") as f:
                content = f.read()

            self.assertIn("EduVision Generation & Repair Evaluation Summary", content)
            self.assertIn("Baseline (Single-shot, No Validator)", content)
            self.assertIn("Full System (Validator ON + Repair Loop)", content)
            self.assertIn("Difficulty Breakdown", content)
            self.assertIn("Error Histogram", content)
            self.assertIn("manim_error", content)
            self.assertIn("timeout", content)


if __name__ == "__main__":
    unittest.main()

