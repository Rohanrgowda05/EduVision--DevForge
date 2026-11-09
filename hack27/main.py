import os
import time
import uuid
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

from planner.pipeline import run_pipeline
from agent.planner_agent import execute_study_plan_agent

app = Flask(__name__)

# Service Boundary Hardening: Drop wildcard CORS.
# Only permit requests from the Express backend orchestrator.
EXPRESS_URL = os.environ.get("EXPRESS_URL", "http://127.0.0.1:3000")
CORS(app, resources={r"/*": {"origins": [EXPRESS_URL, "http://localhost:3000"]}})

INTERNAL_AUTH_TOKEN = os.environ.get("INTERNAL_AUTH_TOKEN", "eduvision-internal-secret-token-key")


@app.before_request
def verify_internal_token():
    """
    Ensure all requests to Flask (including /generate and /static/videos)
    originate from the authorized Express orchestrator carrying X-Internal-Token.
    Health check remains publicly accessible for uptime monitoring.
    """
    if request.path == "/health":
        return None

    token = request.headers.get("X-Internal-Token")
    if not token or token != INTERNAL_AUTH_TOKEN:
        return jsonify({
            "error": "unauthorized",
            "message": "Invalid or missing internal auth token"
        }), 401


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "eduvision-flask",
        "timestamp": time.time()
    }), 200


@app.route("/plan", methods=["POST"])
def plan_study():
    """
    Study-Planner Agent Endpoint (Google ADK).
    Protected by verify_internal_token (same internal-token auth as /generate).
    Input: { userId: str, topicHint: Optional[str], promptText: str }
    Output: StudyPlan JSON
    """
    try:
        data = request.get_json() or {}
        user_id = data.get("userId", "").strip()
        prompt_text = data.get("promptText", "").strip()
        topic_hint = data.get("topicHint")

        if not user_id or not prompt_text:
            return jsonify({"error": "Missing userId or promptText"}), 400

        plan, fallback_used = execute_study_plan_agent(
            user_id=user_id,
            prompt_text=prompt_text,
            topic_hint=topic_hint,
        )

        return jsonify({
            **plan,
            "fallback_used": fallback_used,
        }), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "action": "generate_new",
            "focusConcepts": [],
            "difficulty": "standard",
            "includeYoutube": False,
            "rationale": "Error invoking agent planner; defaulting to standard visualization.",
            "fallback_used": True,
        }), 200


def cleanup_old_videos(videos_dir: str = "static/videos", max_age_hours: int = 24):
    """
    Remove rendered videos older than max_age_hours on startup to prevent disk bloat.
    """
    if not os.path.exists(videos_dir):
        os.makedirs(videos_dir, exist_ok=True)
        return

    cutoff_time = time.time() - (max_age_hours * 3600)
    cleaned_count = 0

    for filename in os.listdir(videos_dir):
        filepath = os.path.join(videos_dir, filename)
        if os.path.isfile(filepath) and filename.endswith(".mp4"):
            try:
                if os.path.getmtime(filepath) < cutoff_time:
                    os.remove(filepath)
                    cleaned_count += 1
            except Exception as e:
                print(f"[WARN] Failed to delete stale video {filename}: {e}")

    if cleaned_count > 0:
        print(f"[CLEANUP] Removed {cleaned_count} video(s) older than {max_age_hours}h.")


@app.route("/generate", methods=["POST"])
def generate_animation():
    try:
        data = request.get_json()

        if not data or "prompt" not in data:
            return jsonify({"error": "Missing 'prompt' field"}), 400

        user_prompt = data["prompt"].strip()
        if not user_prompt:
            return jsonify({"error": "Prompt cannot be empty"}), 400

        # Validate and sanitize optional focus_concepts and difficulty
        raw_focus = data.get("focus_concepts", [])
        focus_concepts = []
        if isinstance(raw_focus, list):
            import re
            for c in raw_focus[:3]:
                if isinstance(c, str):
                    cleaned_c = re.sub(r"[^a-z0-9_]+", "_", c.lower().strip()).strip("_")[:60]
                    if len(cleaned_c) >= 2:
                        focus_concepts.append(cleaned_c)

        difficulty = str(data.get("difficulty", "standard")).lower().strip()
        if difficulty not in ["intro", "standard", "challenging"]:
            difficulty = "standard"

        job_id = uuid.uuid4().hex
        print(f"\n[JOB {job_id}] Processing prompt: {user_prompt} | Focus: {focus_concepts} | Difficulty: {difficulty}")

        result = run_pipeline(
            prompt=user_prompt,
            job_id=job_id,
            focus_concepts=focus_concepts,
            difficulty=difficulty,
        )

        if result.error_type == "rate_limited":
            return jsonify({
                "error": "rate_limited",
                "message": result.error_message,
                "retry_after_s": 60,
                "job_id": job_id
            }), 429

        if not result.ok:
            return jsonify({
                "error": f"Manim failed to render ({result.error_type}). The generated code may have issues.",
                "error_type": result.error_type,
                "job_id": job_id,
                "attempts": result.attempts,
                "stderr_tail": result.error_message
            }), 500

        return jsonify({
            "status": "success",
            "video_url": result.video_url,
            "job_id": job_id,
            "attempts": result.attempts,
            "duration_s": round(result.total_duration_s, 2)
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ------------------------------------------
# Main entry
# ------------------------------------------
if __name__ == "__main__":
    cleanup_old_videos()
    app.run(debug=True, use_reloader=False)
