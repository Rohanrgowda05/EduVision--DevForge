import time
import uuid
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from planner.plannerscript import generate_dsl, repair_dsl, RateLimitExceededError
from planner.validator import validate_manim_code, extract_scene_name_ast
from planner.manim_run import run_manim_script
from planner.telemetry import log_job_telemetry


@dataclass
class AttemptOutcome:
    attempt: int
    stage: str               # "generation" | "validation" | "rendering"
    code: str
    error_type: Optional[str]  # None if successful
    error_message: Optional[str]
    duration_s: float
    violations: List[str] = field(default_factory=list)


@dataclass
class PipelineResult:
    ok: bool
    job_id: str
    video_url: Optional[str]
    attempts: int
    outcomes: List[AttemptOutcome]
    final_code: Optional[str]
    error_type: Optional[str]
    error_message: Optional[str]
    total_duration_s: float
    token_usage: Dict[str, Any] = field(default_factory=dict)


def _fallback_extract_scene_name(code: str) -> str:
    match = re.search(r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*Scene\s*\)", code)
    if match:
        return match.group(1)
    return "Scene"


def _merge_tokens(total_tokens: Dict[str, int], new_usage: Dict[str, Any]) -> None:
    for k in ["input_tokens", "output_tokens", "total_tokens", "prompt_token_count", "candidates_token_count", "total_token_count"]:
        if k in new_usage and isinstance(new_usage[k], (int, float)):
            total_tokens[k] = total_tokens.get(k, 0) + int(new_usage[k])


def run_pipeline(
    prompt: str,
    job_id: Optional[str] = None,
    max_attempts: int = 3,
    output_path: Optional[str] = None,
    enable_validator: bool = True,
    timeout_s: float = 120.0,
    log_telemetry: bool = True,
    focus_concepts: Optional[List[str]] = None,
    difficulty: Optional[str] = None,
) -> PipelineResult:
    """
    Execute the generation -> validation -> render -> repair loop.
    Returns structured PipelineResult and writes job telemetry to logs/jobs.jsonl.
    """
    pipeline_start = time.perf_counter()
    if not job_id:
        job_id = uuid.uuid4().hex

    if not output_path:
        output_path = f"static/videos/{job_id}.mp4"

    video_url = f"/static/videos/{job_id}.mp4"

    outcomes: List[AttemptOutcome] = []
    accumulated_tokens: Dict[str, int] = {}
    last_code: Optional[str] = None
    last_error: str = ""

    def _finalize(res: PipelineResult) -> PipelineResult:
        if log_telemetry:
            per_attempt = [
                {
                    "attempt": o.attempt,
                    "stage": o.stage,
                    "error_type": o.error_type,
                    "duration_s": round(o.duration_s, 3)
                }
                for o in res.outcomes
            ]
            log_job_telemetry(
                job_id=res.job_id,
                prompt=prompt,
                status="success" if res.ok else "failure",
                attempts=res.attempts,
                per_attempt=per_attempt,
                total_latency_s=res.total_duration_s,
                error_type=res.error_type,
                token_usage=res.token_usage if res.token_usage else None
            )
        return res

    for attempt in range(1, max_attempts + 1):
        attempt_start = time.perf_counter()

        # Step A: Generate or Repair DSL code
        try:
            if attempt == 1:
                print(f"[Attempt {attempt}/{max_attempts}] Generating initial Manim script...")
                gen_res = generate_dsl(
                    prompt,
                    focus_concepts=focus_concepts,
                    difficulty=difficulty,
                    return_usage=True,
                )
                if isinstance(gen_res, tuple):
                    code, usage = gen_res
                else:
                    code, usage = gen_res, {}
            else:
                print(f"[Attempt {attempt}/{max_attempts}] Repairing script with error feedback...")
                rep_res = repair_dsl(
                    prompt,
                    last_code or "",
                    last_error,
                    focus_concepts=focus_concepts,
                    difficulty=difficulty,
                    return_usage=True,
                )
                if isinstance(rep_res, tuple):
                    code, usage = rep_res
                else:
                    code, usage = rep_res, {}
            _merge_tokens(accumulated_tokens, usage)
        except RateLimitExceededError as rle:
            duration_s = time.perf_counter() - attempt_start
            outcomes.append(
                AttemptOutcome(
                    attempt=attempt,
                    stage="generation",
                    code="",
                    error_type="rate_limited",
                    error_message=str(rle),
                    duration_s=duration_s
                )
            )
            return _finalize(PipelineResult(
                ok=False,
                job_id=job_id,
                video_url=None,
                attempts=attempt,
                outcomes=outcomes,
                final_code=None,
                error_type="rate_limited",
                error_message=str(rle),
                total_duration_s=time.perf_counter() - pipeline_start,
                token_usage=accumulated_tokens
            ))
        except Exception as e:
            duration_s = time.perf_counter() - attempt_start
            outcomes.append(
                AttemptOutcome(
                    attempt=attempt,
                    stage="generation",
                    code="",
                    error_type="llm_error",
                    error_message=str(e),
                    duration_s=duration_s
                )
            )
            last_error = f"LLM generation failed: {e}"
            continue

        last_code = code

        # Step B: AST Validation Layer
        if enable_validator:
            violations = validate_manim_code(code)
            if violations:
                duration_s = time.perf_counter() - attempt_start
                last_error = "Validation violations:\n" + "\n".join(f"- {v}" for v in violations)
                print(f"[Attempt {attempt}/{max_attempts}] Validation failed with {len(violations)} violations.")
                outcomes.append(
                    AttemptOutcome(
                        attempt=attempt,
                        stage="validation",
                        code=code,
                        error_type="validation",
                        error_message=last_error,
                        duration_s=duration_s,
                        violations=violations
                    )
                )
                continue

        # Step C: Extract Scene Name
        scene_name = extract_scene_name_ast(code) or _fallback_extract_scene_name(code)

        # Step D: Render in Sandbox
        print(f"[Attempt {attempt}/{max_attempts}] Rendering scene '{scene_name}' in sandbox...")
        render_res = run_manim_script(
            manim_code=code,
            scene_name=scene_name,
            output_path=output_path,
            timeout_s=timeout_s,
            job_id=job_id
        )

        duration_s = time.perf_counter() - attempt_start

        if render_res.ok:
            print(f"[Attempt {attempt}/{max_attempts}] Render succeeded in {render_res.duration_s:.2f}s!")
            outcomes.append(
                AttemptOutcome(
                    attempt=attempt,
                    stage="rendering",
                    code=code,
                    error_type=None,
                    error_message=None,
                    duration_s=duration_s
                )
            )
            return _finalize(PipelineResult(
                ok=True,
                job_id=job_id,
                video_url=video_url,
                attempts=attempt,
                outcomes=outcomes,
                final_code=code,
                error_type=None,
                error_message=None,
                total_duration_s=time.perf_counter() - pipeline_start,
                token_usage=accumulated_tokens
            ))

        # Render failed
        last_error = render_res.stderr_tail or f"Rendering failed ({render_res.error_type})"
        print(f"[Attempt {attempt}/{max_attempts}] Render failed ({render_res.error_type}). Tail: {last_error[:150]}")
        outcomes.append(
            AttemptOutcome(
                attempt=attempt,
                stage="rendering",
                code=code,
                error_type=render_res.error_type,
                error_message=last_error,
                duration_s=duration_s
            )
        )

    # Exhausted all attempts
    final_error_type = outcomes[-1].error_type if outcomes else "unknown"
    return _finalize(PipelineResult(
        ok=False,
        job_id=job_id,
        video_url=None,
        attempts=max_attempts,
        outcomes=outcomes,
        final_code=last_code,
        error_type=final_error_type,
        error_message=last_error,
        total_duration_s=time.perf_counter() - pipeline_start,
        token_usage=accumulated_tokens
    ))
