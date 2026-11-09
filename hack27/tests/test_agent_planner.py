import os
import unittest
from unittest.mock import patch, MagicMock

from agent.schema import StudyPlanModel
from agent.tools import create_planner_tools
from agent.planner_agent import (
    execute_study_plan_agent,
    _check_daily_cap,
    _DAILY_PLAN_COUNTS,
    DAILY_AGENT_PLAN_CAP,
)


class TestAgentPlanner(unittest.TestCase):

    def test_schema_valid_plan(self):
        valid_data = {
            "action": "remedial",
            "focusConcepts": ["wave_speed", "frequency_shift"],
            "difficulty": "standard",
            "includeYoutube": True,
            "rationale": "Focusing on weak concepts: wave_speed.",
            "reusedVideoUrl": None,
        }
        plan = StudyPlanModel(**valid_data)
        self.assertEqual(plan.action, "remedial")
        self.assertEqual(len(plan.focusConcepts), 2)
        self.assertTrue(plan.includeYoutube)

    def test_schema_invalid_action(self):
        invalid_data = {
            "action": "unknown_action",
            "focusConcepts": [],
            "difficulty": "standard",
            "includeYoutube": False,
            "rationale": "Test",
        }
        with self.assertRaises(Exception):
            StudyPlanModel(**invalid_data)

    def test_tools_user_isolation(self):
        """Verify that tools inject the bound user_id in closures and cannot be spoofed."""
        bound_user = "user_alpha_123"
        tools = create_planner_tools(bound_user, express_url="http://mock-express:3000")

        with patch("requests.get") as mock_get:
            mock_res = MagicMock()
            mock_res.ok = True
            mock_res.json.return_value = {"topicId": "t1", "concepts": []}
            mock_get.return_value = mock_res

            # Call with topic hint that tries to spoof user_id
            tools["get_learner_profile"]("doppler_effect?userId=victim_beta_456")

            # Check args sent to Express: params['userId'] MUST be user_alpha_123
            mock_get.assert_called_once()
            _, kwargs = mock_get.call_args
            self.assertEqual(kwargs["params"]["userId"], bound_user)

    def test_daily_cap_enforcement(self):
        """Test that exceeding daily planner cap triggers rule-based fallback."""
        test_user = "test_capped_user_99"
        _DAILY_PLAN_COUNTS[test_user] = (DAILY_AGENT_PLAN_CAP, "2026-11-09")

        plan, fallback_used = execute_study_plan_agent(
            user_id=test_user,
            prompt_text="Quantum entanglement visualization",
        )
        self.assertTrue(fallback_used)
        self.assertEqual(plan["action"], "generate_new")
        self.assertIn("quota reached", plan["rationale"])

    def test_missing_api_key_fallback(self):
        """Test that missing GEMINI_API_KEY falls back cleanly without crash."""
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}, clear=False):
            plan, fallback_used = execute_study_plan_agent(
                user_id="unauthed_user_7",
                prompt_text="Introduction to algebra",
            )
            self.assertTrue(fallback_used)
            self.assertEqual(plan["action"], "generate_new")


if __name__ == "__main__":
    unittest.main()

