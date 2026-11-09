import os
import time
import random
import re
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

load_dotenv()

# Custom exception for rate limits
class RateLimitExceededError(Exception):
    def __init__(self, message: str, retry_after_s: float = 60.0):
        super().__init__(message)
        self.retry_after_s = retry_after_s


# Shared LLM instance
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0,
    top_k=1,
)

# Global tracker for rate limiting
_last_call_timestamp: float = 0.0


def _rate_limited_invoke(messages, max_retries: int = 5):
    """
    Invoke LLM with mandatory minimum interval and exponential backoff on 429/quota errors.
    """
    global _last_call_timestamp

    min_interval = float(os.getenv("LLM_MIN_INTERVAL_S", "7.0"))
    now = time.time()
    elapsed = now - _last_call_timestamp
    if elapsed < min_interval:
        sleep_needed = min_interval - elapsed
        time.sleep(sleep_needed)

    for attempt in range(max_retries + 1):
        try:
            _last_call_timestamp = time.time()
            response = llm.invoke(messages)
            return response
        except Exception as e:
            err_str = str(e)
            is_rate_limit = (
                "429" in err_str
                or "RESOURCE_EXHAUSTED" in err_str
                or "quota" in err_str.lower()
                or "rate limit" in err_str.lower()
            )

            if not is_rate_limit:
                raise e

            if attempt == max_retries:
                # Extract retry-after if available in error
                match = re.search(r"retry\s+after\s+(\d+)", err_str, re.IGNORECASE)
                retry_after_s = float(match.group(1)) if match else 60.0
                raise RateLimitExceededError(
                    f"Gemini API rate limit exceeded after {max_retries} retries: {err_str}",
                    retry_after_s=retry_after_s
                )

            # Exponential backoff with jitter
            backoff_base = 2 ** (attempt + 1)
            jitter = random.uniform(0.5, 1.5)
            backoff_s = backoff_base + jitter

            # Check if error message recommends specific delay
            match = re.search(r"retry in (\d+(?:\.\d+)?)s", err_str, re.IGNORECASE)
            if match:
                backoff_s = max(backoff_s, float(match.group(1)) + 1.0)

            print(f"[WARN] Gemini 429/quota hit. Backing off for {backoff_s:.1f}s (retry {attempt+1}/{max_retries})...")
            time.sleep(backoff_s)


MANIM_SYSTEM_RULES = """
You are an educational Manim animation generator.

You will receive a topic and must output ONLY valid Python Manim code.
DO NOT return JSON.
DO NOT return markdown.
DO NOT add backticks.
DO NOT add explanations or comments.
Return ONLY the Manim Python script exactly as it should be executed.

Use this reference style (fixed frame, clean animations, no comments):

from manim import *

config.frame_width = 14
config.frame_height = 7.5

class CNNVisualization(Scene):
    def construct(self):
        title = Text("How a CNN Works", font_size=42).to_edge(UP)
        self.play(FadeIn(title))
        self.wait(0.5)

        text_box = Rectangle(width=6.5, height=1.3, color=BLUE)
        text_box.to_edge(DOWN)
        step_text = Text("", font_size=26).move_to(text_box.get_center())

        self.play(Create(text_box))
        self.add(step_text)

        def update_text(new_text):
            self.play(FadeOut(step_text, shift=UP*0.3), run_time=0.3)
            step_text.become(Text(new_text, font_size=26).move_to(text_box.get_center()))
            self.play(FadeIn(step_text, shift=DOWN*0.3), run_time=0.3)

        # CRITICAL: Call update_text directly, DO NOT wrap it in self.play()
        update_text("Example animation start")
        self.wait(1)

IMPORTANT RULES (NEVER BREAK):
- CRITICAL: Call `update_text("your text")` directly. DO NOT wrap it in `self.play()` because it already plays animations internally.
- DO NOT use MathTex or Tex.
- DO NOT use add_coordinates() because it forces LaTeX DecimalNumber.
- DO NOT use axes labels that require LaTeX.
- DO NOT use DecimalNumber or anything that relies on TeX.
- Use ONLY Text() for labels and numbers.
- If you need mathematical expressions, write them directly using Text().
- All numbers drawn on screen must use Text(), not Tex or MathTex.
- CRITICAL: The `Text` class in Manim does NOT have a `get_part_by_text` method. If you try to use `my_text.get_part_by_text(...)`, the code will CRASH.
- You must animate the entire Text object at once, or create separate Text objects if you want to animate parts independently.
- DO NOT use any methods that slice or select parts of a Text object (like `[0]`).
- DO NOT use `get_unit_normal()` or `get_unit_vector()` on Line objects. These methods DO NOT EXIST in Manim and will CRASH. Instead, calculate normal vectors manually using numpy: e.g. `direction = B - A; normal = np.array([-direction[1], direction[0], 0]); normal = normal / np.linalg.norm(normal)`.
- DO NOT use `RightAngle()` with raw point coordinates. Use `RightAngle(Line(p1, p2), Line(p1, p3), ...)` with actual Line objects.
- DO NOT call `.set_opacity()` as a method on animate. Use `.set_fill(opacity=...)` instead.
- Keep the code extremely simple and robust. Ensure proper python indentation.
- Always import numpy as np at the top if you use numpy operations.
- Only import from manim, numpy, math, and random. Never import os, sys, subprocess, or open files.
"""


def _clean_code(content: str) -> str:
    """Strip markdown formatting and code fences."""
    cleaned = content.strip()
    if cleaned.startswith("```python"):
        cleaned = cleaned[len("```python"):]
    elif cleaned.startswith("```"):
        cleaned = cleaned[len("```"):]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _extract_token_usage(response) -> dict:
    """Safely extract token usage metadata from LangChain response."""
    usage = {}
    try:
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            usage = dict(response.usage_metadata)
        elif hasattr(response, "response_metadata") and isinstance(response.response_metadata, dict):
            raw_usage = (
                response.response_metadata.get("usage_metadata")
                or response.response_metadata.get("token_usage")
            )
            if isinstance(raw_usage, dict):
                usage = dict(raw_usage)
    except Exception:
        pass
    return usage


def generate_dsl(
    user_prompt: str,
    focus_concepts: list = None,
    difficulty: str = None,
    return_usage: bool = False
):
    """
    Call Gemini and return ONLY pure Manim code (NO JSON, NO Markdown).
    If return_usage=True, returns tuple: (code, token_usage_dict).
    """
    extra_instructions = []
    if focus_concepts and len(focus_concepts) > 0:
        extra_instructions.append(f"Emphasize visually: {', '.join(focus_concepts)}.")
    if difficulty:
        extra_instructions.append(f"Visual difficulty level: {difficulty}.")

    personalization_block = ("\n" + " ".join(extra_instructions) + "\n") if extra_instructions else ""

    user_instruction = f"""
Generate a Manim animation for the following concept:

{user_prompt}
{personalization_block}
Return ONLY the raw Manim Python code.
Do not include comments, explanations, JSON, or backticks.
"""

    messages = [
        ("system", MANIM_SYSTEM_RULES),
        ("human", user_instruction),
    ]

    response = _rate_limited_invoke(messages)
    code = _clean_code(response.content)
    if return_usage:
        return code, _extract_token_usage(response)
    return code


def repair_dsl(
    prompt: str,
    previous_code: str,
    error_text: str,
    focus_concepts: list = None,
    difficulty: str = None,
    return_usage: bool = False
):
    """
    Ask Gemini to fix errors in the previous Manim script.
    Outputs the FULL corrected script with only necessary fixes.
    If return_usage=True, returns tuple: (code, token_usage_dict).
    """
    extra_instructions = []
    if focus_concepts and len(focus_concepts) > 0:
        extra_instructions.append(f"Emphasize visually: {', '.join(focus_concepts)}.")
    if difficulty:
        extra_instructions.append(f"Visual difficulty level: {difficulty}.")

    personalization_block = ("\n" + " ".join(extra_instructions) + "\n") if extra_instructions else ""

    repair_instruction = f"""
The following Manim script was generated for the topic:
"{prompt}"
{personalization_block}
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

    messages = [
        ("system", MANIM_SYSTEM_RULES),
        ("human", repair_instruction),
    ]

    response = _rate_limited_invoke(messages)
    code = _clean_code(response.content)
    if return_usage:
        return code, _extract_token_usage(response)
    return code
