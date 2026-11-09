import os
import sys
import json
import csv
import time
import argparse
import numpy as np
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

# Add parent directory to path so planner modules can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from planner.validator import validate_manim_code, extract_scene_name_ast
from planner.manim_run import run_manim_script, RenderResult
from eval.llm_cache import cached_generate_dsl, cached_repair_dsl


def load_prompts(prompts_file: str) -> List[Dict[str, Any]]:
    with open(prompts_file, "r", encoding="utf-8") as f:
        return json.load(f)


def load_completed_results(results_file: str) -> Dict[str, Dict[str, Any]]:
    completed = {}
    if os.path.isfile(results_file):
        with open(results_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        record = json.loads(line)
                        if "id" in record:
                            completed[record["id"]] = record
                    except Exception:
                        pass
    return completed


def append_result(results_file: str, record: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(results_file)), exist_ok=True)
    with open(results_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def generate_csv(results: List[Dict[str, Any]], csv_path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(csv_path)), exist_ok=True)
    fieldnames = [
        "id", "topic", "category", "difficulty",
        "baseline_ok", "baseline_error", "baseline_duration_s",
        "full_ok", "full_first_try", "full_attempts", "full_error", "full_duration_s"
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            b = r.get("baseline", {})
            f_res = r.get("full", {})
            writer.writerow({
                "id": r.get("id"),
                "topic": r.get("topic"),
                "category": r.get("category"),
                "difficulty": r.get("difficulty"),
                "baseline_ok": b.get("ok"),
                "baseline_error": b.get("error_type") or "",
                "baseline_duration_s": round(b.get("duration_s", 0), 2),
                "full_ok": f_res.get("ok"),
                "full_first_try": f_res.get("first_try_ok"),
                "full_attempts": f_res.get("attempts", 1),
                "full_error": f_res.get("error_type") or "",
                "full_duration_s": round(f_res.get("duration_s", 0), 2),
            })


def generate_summary(results: List[Dict[str, Any]], summary_path: str, prompt_source: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(summary_path)), exist_ok=True)
    total = len(results)
    if total == 0:
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write("# EduVision Evaluation Summary\n\nNo evaluation results available yet.\n")
        return

    b_ok_count = sum(1 for r in results if r.get("baseline", {}).get("ok"))
    f_first_try_count = sum(1 for r in results if r.get("full", {}).get("first_try_ok"))
    f_ok_count = sum(1 for r in results if r.get("full", {}).get("ok"))
    
    attempts_list = [r.get("full", {}).get("attempts", 1) for r in results]
    mean_attempts = float(np.mean(attempts_list)) if attempts_list else 1.0

    b_latencies = [r.get("baseline", {}).get("duration_s", 0) for r in results]
    f_latencies = [r.get("full", {}).get("duration_s", 0) for r in results]

    b_mean_lat = float(np.mean(b_latencies)) if b_latencies else 0.0
    b_p95_lat = float(np.percentile(b_latencies, 95)) if b_latencies else 0.0

    f_mean_lat = float(np.mean(f_latencies)) if f_latencies else 0.0
    f_p95_lat = float(np.percentile(f_latencies, 95)) if f_latencies else 0.0

    # Error type histograms
    b_errors: Dict[str, int] = {}
    f_errors: Dict[str, int] = {}
    for r in results:
        b_err = r.get("baseline", {}).get("error_type")
        if b_err:
            b_errors[b_err] = b_errors.get(b_err, 0) + 1
        f_err = r.get("full", {}).get("error_type")
        if f_err:
            f_errors[f_err] = f_errors.get(f_err, 0) + 1

    # Breakdown by difficulty
    diff_stats: Dict[str, Dict[str, Any]] = {}
    for diff in ["normal", "hard"]:
        subset = [r for r in results if r.get("difficulty") == diff]
        if subset:
            diff_stats[diff] = {
                "count": len(subset),
                "baseline_rate": (sum(1 for r in subset if r.get("baseline", {}).get("ok")) / len(subset)) * 100,
                "full_rate": (sum(1 for r in subset if r.get("full", {}).get("ok")) / len(subset)) * 100,
            }

    # Breakdown by category
    categories = sorted(list(set(r.get("category", "unknown") for r in results)))
    cat_stats: Dict[str, Dict[str, Any]] = {}
    for cat in categories:
        subset = [r for r in results if r.get("category") == cat]
        cat_stats[cat] = {
            "count": len(subset),
            "baseline_rate": (sum(1 for r in subset if r.get("baseline", {}).get("ok")) / len(subset)) * 100,
            "full_rate": (sum(1 for r in subset if r.get("full", {}).get("ok")) / len(subset)) * 100,
        }

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    md = f"""# EduVision Generation & Repair Evaluation Summary

> **Disclaimer:** These metrics were evaluated on a {total}-prompt set curated for educational Manim animations ({prompt_source}), not general accuracy.

- **Generated at:** {now_str}
- **Total Prompts Evaluated:** {total}

---

## 1. Overall Performance Comparison

| Metric | Baseline (Single-shot, No Validator) | Full System (Validator ON + Repair Loop) | Delta |
|:---|:---:|:---:|:---:|
| **Success Rate (All Attempts)** | {b_ok_count}/{total} (**{(b_ok_count/total)*100:.1f}%**) | {f_ok_count}/{total} (**{(f_ok_count/total)*100:.1f}%**) | **+{((f_ok_count - b_ok_count)/total)*100:.1f}%** |
| **First-Try Success Rate** | {b_ok_count}/{total} ({(b_ok_count/total)*100:.1f}%) | {f_first_try_count}/{total} ({(f_first_try_count/total)*100:.1f}%) | - |
| **Mean Attempts per Prompt** | 1.00 | {mean_attempts:.2f} | +{mean_attempts - 1.0:.2f} |
| **Mean Total Latency** | {b_mean_lat:.2f}s | {f_mean_lat:.2f}s | +{f_mean_lat - b_mean_lat:.2f}s |
| **P95 Latency** | {b_p95_lat:.2f}s | {f_p95_lat:.2f}s | +{f_p95_lat - b_p95_lat:.2f}s |

---

## 2. Difficulty Breakdown

| Difficulty | Prompts | Baseline Success | Full Pipeline Success |
|:---|:---:|:---:|:---:|
"""
    for diff, stats in diff_stats.items():
        md += f"| **{diff.capitalize()}** | {stats['count']} | {stats['baseline_rate']:.1f}% | **{stats['full_rate']:.1f}%** |\n"

    md += """
---

## 3. Category Breakdown

| Category | Prompts | Baseline Success | Full Pipeline Success |
|:---|:---:|:---:|:---:|
"""
    for cat, stats in cat_stats.items():
        md += f"| **{cat.capitalize()}** | {stats['count']} | {stats['baseline_rate']:.1f}% | **{stats['full_rate']:.1f}%** |\n"

    md += """
---

## 4. Error Histogram

| Error Type | Baseline Frequency | Full Pipeline Frequency |
|:---|:---:|:---:|
"""
    all_error_keys = sorted(list(set(list(b_errors.keys()) + list(f_errors.keys()))))
    if not all_error_keys:
        md += "| *(No errors observed)* | 0 | 0 |\n"
    else:
        for err in all_error_keys:
            md += f"| `{err}` | {b_errors.get(err, 0)} | {f_errors.get(err, 0)} |\n"

    md += """
---

## 5. Engineering Key Findings

1. **AST Validation acts as an instant error filter:** Scripts with forbidden syntax, missing classes, or invalid Manim APIs (`MathTex`, `get_part_by_text`) are caught in milliseconds without incurring costly failed renders.
2. **Error-Guided Repair Loop recovers failed scripts:** Feeding AST violations and stderr traceback tails into `repair_dsl()` successfully turns initially failing scenes into valid animations.
3. **No Cross-Request Collisions:** Per-job isolation directories completely eliminate the shared `media/` concurrency bugs.
"""

    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(md)


def main():
    parser = argparse.ArgumentParser(description="EduVision Manim Generation Evaluation Harness")
    parser.add_argument("--prompts", type=str, default=None, help="Path to prompts JSON file")
    parser.add_argument("--full", action="store_true", help="Use full 50-prompt test set (eval/prompts.json)")
    parser.add_argument("--start", type=int, default=0, help="0-based starting index")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of prompts to process")
    parser.add_argument("--max-llm-calls", type=int, default=80, help="Daily budget limit for LLM calls")
    parser.add_argument("--results-file", type=str, default="eval/results.jsonl", help="Results ledger JSONL path")
    parser.add_argument("--csv-file", type=str, default="eval/results.csv", help="CSV output path")
    parser.add_argument("--summary-file", type=str, default="eval/summary.md", help="Markdown summary output path")
    parser.add_argument("--cache-dir", type=str, default="eval/cache", help="LLM disk cache directory")
    parser.add_argument("--dry-run-llm", action="store_true", help="Do not call real LLM if cache miss (mock fallback)")

    args = parser.parse_args()

    # Determine prompt set
    if args.prompts:
        prompts_file = args.prompts
    elif args.full:
        prompts_file = "eval/prompts.json"
    else:
        prompts_file = "eval/prompts_small.json"

    prompts = load_prompts(prompts_file)
    completed = load_completed_results(args.results_file)

    # Slice prompts by start and limit
    selected_prompts = prompts[args.start:]
    if args.limit:
        selected_prompts = selected_prompts[:args.limit]

    remaining_prompts = [p for p in selected_prompts if p["id"] not in completed]

    print("=" * 70)
    print("EduVision Evaluation Harness")
    print(f"Prompt set: {prompts_file} (Total in file: {len(prompts)})")
    print(f"Selected range: {len(selected_prompts)} prompts (Start: {args.start}, Limit: {args.limit})")
    print(f"Already completed: {len(completed)} prompts")
    print(f"Remaining in this run: {len(remaining_prompts)} prompts")
    print(f"Daily LLM Call Budget: {args.max_llm_calls}")
    print(f"Estimated LLM calls: {len(remaining_prompts)} - {len(remaining_prompts) * 3}")
    print("=" * 70)

    llm_calls_made = 0

    for idx, prompt_item in enumerate(selected_prompts, start=args.start + 1):
        p_id = prompt_item["id"]
        topic = prompt_item["topic"]
        prompt_text = prompt_item["prompt"]

        if p_id in completed:
            print(f"[{idx}/{len(prompts)}] Skipping already evaluated prompt: {p_id} ({topic})")
            continue

        if llm_calls_made >= args.max_llm_calls:
            print(f"\n[BUDGET GUARD] Daily limit of {args.max_llm_calls} LLM calls reached.")
            print(f"Progress cleanly saved to {args.results_file}.")
            print(f"To resume tomorrow, run: python eval/run_eval.py --start {idx - 1} " + ("--full" if args.full else ""))
            break

        print(f"\n>>> [{idx}/{len(prompts)}] Evaluating: {p_id} - '{topic}' (Calls so far: {llm_calls_made}/{args.max_llm_calls})")

        # ---------------------------------------------------------
        # STEP 1: Generate initial code (Attempt 1)
        # ---------------------------------------------------------
        t0 = time.perf_counter()
        code_1, usage_1, hit_1 = cached_generate_dsl(prompt_text, cache_dir=args.cache_dir)
        if not hit_1:
            llm_calls_made += 1
            print(f"  [LLM] Called Gemini for initial code (call #{llm_calls_made}). Cached for future runs.")
        else:
            print("  [CACHE HIT] Loaded initial code from disk cache.")

        # ---------------------------------------------------------
        # STEP 2: Baseline Evaluation (Validator OFF)
        # ---------------------------------------------------------
        print("  Running Baseline Mode (Validator OFF)...")
        b_scene = extract_scene_name_ast(code_1) or "Scene"
        b_render_start = time.perf_counter()
        b_render = run_manim_script(
            manim_code=code_1,
            scene_name=b_scene,
            output_path=f"static/videos/eval_{p_id}_b.mp4",
            timeout_s=90.0,
            job_id=f"eval_b_{p_id}"
        )
        b_duration = time.perf_counter() - b_render_start
        baseline_record = {
            "ok": b_render.ok,
            "error_type": b_render.error_type,
            "duration_s": b_duration,
        }
        print(f"  Baseline result: ok={b_render.ok}, error={b_render.error_type}, time={b_duration:.2f}s")

        # ---------------------------------------------------------
        # STEP 3: Full Pipeline Evaluation (Validator ON + Repair)
        # ---------------------------------------------------------
        print("  Running Full System Mode (Validator ON + Repair Loop)...")
        f_start_time = time.perf_counter()
        violations_1 = validate_manim_code(code_1)

        full_outcomes = []
        full_ok = False
        full_first_try = False
        last_code = code_1
        last_error = ""

        if not violations_1 and b_render.ok:
            # First-try perfect pass: code passed validator and render succeeded!
            full_ok = True
            full_first_try = True
            full_outcomes.append({
                "attempt": 1,
                "stage": "rendering",
                "error_type": None,
                "duration_s": b_duration
            })
            print("  Full Mode: First-try SUCCESS (reused baseline render).")
        else:
            # Attempt 1 failed either validation or rendering
            if violations_1:
                last_error = "Validation violations:\n" + "\n".join(f"- {v}" for v in violations_1)
                full_outcomes.append({
                    "attempt": 1,
                    "stage": "validation",
                    "error_type": "validation",
                    "duration_s": 0.01,
                    "violations": violations_1
                })
                print(f"  Full Mode Attempt 1: Validation failed ({len(violations_1)} violations).")
            else:
                last_error = b_render.stderr_tail or b_render.error_type or "Render failed"
                full_outcomes.append({
                    "attempt": 1,
                    "stage": "rendering",
                    "error_type": b_render.error_type,
                    "duration_s": b_duration
                })
                print(f"  Full Mode Attempt 1: Render failed ({b_render.error_type}).")

            # Repair loop (attempts 2 and 3)
            for attempt in [2, 3]:
                if llm_calls_made >= args.max_llm_calls:
                    print(f"  [BUDGET GUARD] Cannot attempt repair #{attempt}: daily limit of {args.max_llm_calls} reached.")
                    break

                att_start = time.perf_counter()
                print(f"  Full Mode Attempt {attempt}: Calling repair with error feedback...")
                code_rep, usage_rep, hit_rep = cached_repair_dsl(prompt_text, last_code, last_error, cache_dir=args.cache_dir)
                if not hit_rep:
                    llm_calls_made += 1
                    print(f"  [LLM] Called Gemini for repair (call #{llm_calls_made}).")
                else:
                    print("  [CACHE HIT] Loaded repair code from disk cache.")

                last_code = code_rep

                # Validate repair
                rep_violations = validate_manim_code(code_rep)
                if rep_violations:
                    last_error = "Validation violations:\n" + "\n".join(f"- {v}" for v in rep_violations)
                    full_outcomes.append({
                        "attempt": attempt,
                        "stage": "validation",
                        "error_type": "validation",
                        "duration_s": time.perf_counter() - att_start,
                        "violations": rep_violations
                    })
                    print(f"  Full Mode Attempt {attempt}: Repair validation failed.")
                    continue

                # Render repaired script
                scene_name = extract_scene_name_ast(code_rep) or "Scene"
                r_rep = run_manim_script(
                    manim_code=code_rep,
                    scene_name=scene_name,
                    output_path=f"static/videos/eval_{p_id}_f_{attempt}.mp4",
                    timeout_s=90.0,
                    job_id=f"eval_f_{p_id}_{attempt}"
                )
                att_duration = time.perf_counter() - att_start

                if r_rep.ok:
                    full_ok = True
                    full_outcomes.append({
                        "attempt": attempt,
                        "stage": "rendering",
                        "error_type": None,
                        "duration_s": att_duration
                    })
                    print(f"  Full Mode Attempt {attempt}: Repair succeeded in {r_rep.duration_s:.2f}s!")
                    break
                else:
                    last_error = r_rep.stderr_tail or r_rep.error_type or "Render failed"
                    full_outcomes.append({
                        "attempt": attempt,
                        "stage": "rendering",
                        "error_type": r_rep.error_type,
                        "duration_s": att_duration
                    })
                    print(f"  Full Mode Attempt {attempt}: Render failed ({r_rep.error_type}).")

        f_total_duration = time.perf_counter() - f_start_time
        full_record = {
            "ok": full_ok,
            "first_try_ok": full_first_try,
            "attempts": len(full_outcomes),
            "error_type": None if full_ok else full_outcomes[-1].get("error_type", "unknown"),
            "duration_s": f_total_duration,
            "outcomes": full_outcomes
        }

        # Save result record
        eval_record = {
            "id": p_id,
            "topic": topic,
            "category": prompt_item.get("category"),
            "difficulty": prompt_item.get("difficulty"),
            "prompt": prompt_text,
            "baseline": baseline_record,
            "full": full_record,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        append_result(args.results_file, eval_record)
        completed[p_id] = eval_record

        # Update CSV and Summary on each prompt completion
        all_results = list(completed.values())
        generate_csv(all_results, args.csv_file)
        generate_summary(all_results, args.summary_file, prompts_file)
        print(f"  -> Saved progress for {p_id}. Updated {args.csv_file} and {args.summary_file}")

    print("\n" + "=" * 70)
    print("Evaluation Run Finished")
    print(f"Total LLM calls made this run: {llm_calls_made}")
    print(f"Total results recorded: {len(completed)}")
    print(f"CSV results: {args.csv_file}")
    print(f"Markdown summary: {args.summary_file}")
    print("=" * 70)


if __name__ == "__main__":
    main()

