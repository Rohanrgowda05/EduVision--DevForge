import os
import json
import time
import hashlib
from typing import Dict, Any, Optional, Tuple

from google.adk import Agent
from google.genai import Client
from pydantic import ValidationError

from agent.schema import StudyPlanModel
from agent.tools import create_planner_tools

# In-memory agent plan cache: (user_id, topic_hint, profile_hash) -> (StudyPlanModel, timestamp)
_PLAN_CACHE: Dict[str, Tuple[Dict[str, Any], float]] = {}
CACHE_TTL_S = 3600 # 1 hour

# Per-user daily plan counters
_DAILY_PLAN_COUNTS: Dict[str, Tuple[int, str]] = {}
DAILY_AGENT_PLAN_CAP = int(os.environ.get("DAILY_AGENT_PLAN_CAP", "20"))


def _get_cache_key(user_id: str, topic_hint: str, profile_data: str) -> str:
    h = hashlib.sha256(profile_data.encode()).hexdigest()[:16]
    return f"{user_id}:{topic_hint}:{h}"


def _check_daily_cap(user_id: str) -> bool:
    today_str = time.strftime("%Y-%m-%d")
    count, date_str = _DAILY_PLAN_COUNTS.get(user_id, (0, today_str))
    if date_str != today_str:
        count = 0
    if count >= DAILY_AGENT_PLAN_CAP:
        return False
    _DAILY_PLAN_COUNTS[user_id] = (count + 1, today_str)
    return True


def log_agent_telemetry(
    user_id: str,
    prompt: str,
    topic: str,
    plan_dict: Dict[str, Any],
    tools_called: list,
    llm_calls: int,
    latency_s: float,
    fallback_used: bool,
    error: Optional[str] = None
):
    """Log structured agent execution metrics for evaluation."""
    os.makedirs("logs", exist_ok=True)
    entry = {
        "timestamp": time.time(),
        "user_id": user_id,
        "prompt": prompt,
        "topic": topic,
        "action": plan_dict.get("action"),
        "focus_concepts": plan_dict.get("focusConcepts", []),
        "tools_called": tools_called,
        "llm_calls": llm_calls,
        "latency_s": round(latency_s, 3),
        "fallback_used": fallback_used,
        "error": error,
    }
    try:
        with open("logs/agent_planner.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print("[Agent Telemetry] Failed to log:", e)


def execute_study_plan_agent(
    user_id: str,
    prompt_text: str,
    topic_hint: Optional[str] = None,
    max_turns: int = 4
) -> Tuple[Dict[str, Any], bool]:
    """
    Executes the ADK Study-Planner Agent.
    Returns: (plan_dict, fallback_used)
    Guarantees: Never raises; always returns a valid StudyPlan dictionary.
    """
    start_time = time.perf_counter()
    tools_called = []
    llm_calls = 0

    # Fallback plan template
    def make_fallback(rationale: str = "Standard foundational visualization.") -> Dict[str, Any]:
        return {
            "action": "generate_new",
            "focusConcepts": [],
            "difficulty": "standard",
            "includeYoutube": False,
            "rationale": rationale,
            "reusedVideoUrl": None,
        }

    # 1. Enforce per-user daily plan cap
    if not _check_daily_cap(user_id):
        latency_s = time.perf_counter() - start_time
        fb = make_fallback("Daily agent planner quota reached. Using standard visualization plan.")
        log_agent_telemetry(user_id, prompt_text, topic_hint or "", fb, [], 0, latency_s, fallback_used=True, error="daily_cap_exceeded")
        return fb, True

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        latency_s = time.perf_counter() - start_time
        fb = make_fallback("GEMINI_API_KEY unconfigured.")
        log_agent_telemetry(user_id, prompt_text, topic_hint or "", fb, [], 0, latency_s, fallback_used=True, error="no_api_key")
        return fb, True

    # 2. Tool setup with user isolation
    tool_dict = create_planner_tools(user_id)
    tool_funcs = list(tool_dict.values())

    # Pre-fetch learner profile for cache key and prompt context
    target_topic = topic_hint or prompt_text.strip().lower()
    raw_profile = tool_dict["get_learner_profile"](target_topic)
    tools_called.append("get_learner_profile")

    cache_key = _get_cache_key(user_id, target_topic, json.dumps(raw_profile, sort_keys=True))
    if cache_key in _PLAN_CACHE:
        cached_plan, ts = _PLAN_CACHE[cache_key]
        if time.time() - ts < CACHE_TTL_S:
            latency_s = time.perf_counter() - start_time
            log_agent_telemetry(user_id, prompt_text, target_topic, cached_plan, ["cache_hit"], 0, latency_s, fallback_used=False)
            return cached_plan, False

    # 3. Two-Stage Agent Execution:
    # Stage 1: Reason about learner needs using tools
    # Stage 2: Format and validate against Pydantic schema
    try:
        client = Client(api_key=api_key)

        # Stage 1: Tool-using investigation
        assets = tool_dict["find_existing_assets"](target_topic)
        tools_called.append("find_existing_assets")

        system_instruction = f"""You are the EduVision Study-Planner.
Your goal is to personalize the study plan for a student based on their mastery profile and existing assets.

Learner Profile for topic '{target_topic}':
{json.dumps(raw_profile, indent=2)}

Existing Assets for topic '{target_topic}':
{json.dumps(assets, indent=2)}

Rules for plan proposal:
- If weak concepts exist (status: 'weak'): set action to 'remedial', focus on up to 3 weakest concepts (lowest mastery first), difficulty: 'standard', includeYoutube: true. Explain which concepts were missed in rationale.
- If an existing video was generated within the last 24h and there are no weak concepts: set action to 'reuse_existing', set reusedVideoUrl to the asset's videoUrl, includeYoutube: false.
- If all known concepts have strong status (status: 'strong') with evidence >= 3: set action to 'advanced', difficulty: 'challenging', includeYoutube: true.
- If no history or first time: set action to 'generate_new', difficulty: 'standard', includeYoutube: false.

Output ONLY valid JSON matching this exact structure:
{{
  "action": "generate_new" | "reuse_existing" | "remedial" | "advanced",
  "focusConcepts": ["concept_1", "concept_2"],
  "difficulty": "intro" | "standard" | "challenging",
  "includeYoutube": true | false,
  "rationale": "plain-language reason shown to student",
  "reusedVideoUrl": null or "/static/videos/..."
}}"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"Topic: {target_topic}\nPrompt: {prompt_text}\nPropose the study plan JSON.",
            config={"system_instruction": system_instruction}
        )
        llm_calls += 1

        text = response.text.strip()
        cleaned_json = text.replace("```json", "").replace("```", "").strip()
        plan_dict = json.loads(cleaned_json)

        # Validate with Pydantic
        validated_plan = StudyPlanModel(**plan_dict).model_dump()

        # Cache valid plan
        _PLAN_CACHE[cache_key] = (validated_plan, time.time())

        latency_s = time.perf_counter() - start_time
        log_agent_telemetry(user_id, prompt_text, target_topic, validated_plan, tools_called, llm_calls, latency_s, fallback_used=False)
        return validated_plan, False

    except (ValidationError, json.JSONDecodeError) as parse_err:
        # Attempt one repair turn
        print(f"[Study-Planner Agent] Schema validation failed ({parse_err}), attempting 1 repair turn...")
        try:
            repair_prompt = f"The previous output failed validation: {parse_err}. Correct it and return strictly valid JSON matching the schema."
            rep_res = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=repair_prompt,
                config={"system_instruction": system_instruction}
            )
            llm_calls += 1
            cleaned_rep = rep_res.text.strip().replace("```json", "").replace("```", "").strip()
            repaired_dict = json.loads(cleaned_rep)
            validated_repaired = StudyPlanModel(**repaired_dict).model_dump()

            latency_s = time.perf_counter() - start_time
            log_agent_telemetry(user_id, prompt_text, target_topic, validated_repaired, tools_called, llm_calls, latency_s, fallback_used=False)
            return validated_repaired, False
        except Exception as rep_fail:
            print("[Study-Planner Agent] Repair failed, falling back to rule-based plan:", rep_fail)

    except Exception as agent_err:
        print("[Study-Planner Agent] Error executing agent, falling back to rule-based plan:", agent_err)

    # Fallback to rule-based plan
    latency_s = time.perf_counter() - start_time
    fallback_plan = make_fallback("Continuing topic exploration with standard visualization.")
    log_agent_telemetry(user_id, prompt_text, target_topic, fallback_plan, tools_called, llm_calls, latency_s, fallback_used=True, error="agent_exception")
    return fallback_plan, True

