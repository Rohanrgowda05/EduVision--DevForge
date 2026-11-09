import os
import json
import hashlib
import time
from typing import Optional, Tuple, Dict, Any

from planner.plannerscript import (
    generate_dsl,
    repair_dsl,
    MANIM_SYSTEM_RULES,
)

MODEL_NAME = "gemini-2.5-flash"


def _compute_cache_key(model: str, system_prompt: str, user_prompt: str) -> str:
    payload = f"{model}:::{system_prompt}:::{user_prompt}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def get_cached_response(
    system_prompt: str,
    user_prompt: str,
    cache_dir: str = "eval/cache"
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Retrieve cached response if present. Returns (code, usage) or None."""
    key = _compute_cache_key(MODEL_NAME, system_prompt, user_prompt)
    cache_path = os.path.join(cache_dir, f"{key}.json")
    if os.path.isfile(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("code", ""), data.get("usage", {})
        except Exception:
            return None
    return None


def save_cached_response(
    system_prompt: str,
    user_prompt: str,
    code: str,
    usage: Dict[str, Any],
    cache_dir: str = "eval/cache"
) -> None:
    """Store generated response to disk cache."""
    os.makedirs(cache_dir, exist_ok=True)
    key = _compute_cache_key(MODEL_NAME, system_prompt, user_prompt)
    cache_path = os.path.join(cache_dir, f"{key}.json")
    payload = {
        "key": key,
        "model": MODEL_NAME,
        "timestamp": time.time(),
        "code": code,
        "usage": usage
    }
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except Exception as e:
        print(f"[WARN] Failed to write to LLM cache: {e}")


def cached_generate_dsl(
    prompt: str,
    cache_dir: str = "eval/cache"
) -> Tuple[str, Dict[str, Any], bool]:
    """
    Generate DSL using disk cache.
    Returns (code, usage, is_cache_hit).
    """
    user_instruction = f"""
Generate a Manim animation for the following concept:

{prompt}

Return ONLY the raw Manim Python code.
Do not include comments, explanations, JSON, or backticks.
"""
    cached = get_cached_response(MANIM_SYSTEM_RULES, user_instruction, cache_dir)
    if cached is not None:
        return cached[0], cached[1], True

    code, usage = generate_dsl(prompt, return_usage=True)
    save_cached_response(MANIM_SYSTEM_RULES, user_instruction, code, usage, cache_dir)
    return code, usage, False


def cached_repair_dsl(
    prompt: str,
    previous_code: str,
    error_text: str,
    cache_dir: str = "eval/cache"
) -> Tuple[str, Dict[str, Any], bool]:
    """
    Repair DSL using disk cache.
    Returns (code, usage, is_cache_hit).
    """
    repair_instruction = f"""
The following Manim script was generated for the topic:
"{prompt}"

However, running or validating it failed with this error:
---
{error_text}
---

Here is the failing code:
```python
{previous_code}
```

Task:
Fix the error and output the FULL corrected Python Manim script.
Keep all existing animation logic intact; only fix what caused the error.
Obey all the rules (use Text(), no MathTex/Tex, no get_part_by_text, no get_unit_normal, etc.).
Output ONLY the raw Manim Python script.
DO NOT include markdown fences, comments, or explanations.
"""
    cached = get_cached_response(MANIM_SYSTEM_RULES, repair_instruction, cache_dir)
    if cached is not None:
        return cached[0], cached[1], True

    code, usage = repair_dsl(prompt, previous_code, error_text, return_usage=True)
    save_cached_response(MANIM_SYSTEM_RULES, repair_instruction, code, usage, cache_dir)
    return code, usage, False

