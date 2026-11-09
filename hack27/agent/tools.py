import os
import requests
from typing import List, Dict, Any, Callable

def create_planner_tools(
    user_id: str,
    express_url: str = None,
    internal_token: str = None
) -> Dict[str, Callable]:
    """
    Creates read-only planner tools bound to the specific user_id in closure.
    Security guarantee: The LLM model is never exposed to user_id and cannot
    query or tamper with another user's records.
    """
    base_url = express_url or os.environ.get("EXPRESS_URL", "http://127.0.0.1:3000")
    token = internal_token or os.environ.get("INTERNAL_AUTH_TOKEN", "eduvision-internal-secret-token-key")

    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": token,
    }

    def get_learner_profile(topic: str) -> Dict[str, Any]:
        """
        Get the learner's mastery profile (concepts, mastery scores, evidence counts, weak/strong status)
        for a specific topic.
        Args:
            topic: The canonical topic name or topic ID (e.g. 'doppler_effect').
        """
        try:
            res = requests.get(
                f"{base_url}/api/internal/learner-profile",
                params={"userId": user_id, "topic": topic},
                headers=headers,
                timeout=5.0,
            )
            if res.ok:
                return res.json()
            return {"error": f"Failed with status {res.status_code}"}
        except Exception as e:
            return {"error": str(e)}

    def list_user_topics() -> List[Dict[str, Any]]:
        """
        List all canonical topics previously created or studied by the user.
        """
        try:
            res = requests.get(
                f"{base_url}/api/internal/user-topics",
                params={"userId": user_id},
                headers=headers,
                timeout=5.0,
            )
            if res.ok:
                return res.json()
            return []
        except Exception as e:
            return [{"error": str(e)}]

    def find_existing_assets(topic: str) -> Dict[str, Any]:
        """
        Find the user's most recent video, notes, and quiz for a given topic, along with their ages in hours.
        Args:
            topic: The canonical topic name or topic ID.
        """
        try:
            res = requests.get(
                f"{base_url}/api/internal/existing-assets",
                params={"userId": user_id, "topic": topic},
                headers=headers,
                timeout=5.0,
            )
            if res.ok:
                return res.json()
            return {}
        except Exception as e:
            return {"error": str(e)}

    return {
        "get_learner_profile": get_learner_profile,
        "list_user_topics": list_user_topics,
        "find_existing_assets": find_existing_assets,
    }

