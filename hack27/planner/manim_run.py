import subprocess
import tempfile
import os
import sys
import shutil
import time
import glob
import uuid
from dataclasses import dataclass


@dataclass
class RenderResult:
    ok: bool
    video_path: str | None
    error_type: str | None   # "validation" | "timeout" | "manim_error" | "no_output" | "sandbox_error"
    stderr_tail: str         # last ~40 lines of stderr for feeding back to the LLM
    duration_s: float


def _extract_stderr_tail(stderr: str, max_lines: int = 40) -> str:
    """Extract the last `max_lines` lines from stderr."""
    if not stderr:
        return ""
    lines = stderr.strip().splitlines()
    return "\n".join(lines[-max_lines:]) if lines else ""


def _find_rendered_mp4(media_dir: str, scene_name: str) -> str | None:
    """Find the rendered MP4 file inside media_dir using recursive globbing."""
    if not os.path.exists(media_dir):
        return None

    mp4_candidates = glob.glob(os.path.join(media_dir, "**", "*.mp4"), recursive=True)
    if not mp4_candidates:
        return None

    # Prefer file matching scene_name, fallback to first found MP4
    for candidate in mp4_candidates:
        if scene_name in os.path.basename(candidate):
            return candidate
    return mp4_candidates[0]


def _render_docker(
    job_dir: str,
    scene_name: str,
    job_id: str,
    timeout_s: float
) -> tuple[int, str, str, bool]:
    """
    Run rendering inside an isolated Docker container.
    Returns (returncode, stdout, stderr, timed_out).
    """
    container_name = f"eduvision-{job_id}"
    abs_job_dir = os.path.abspath(job_dir).replace("\\", "/")

    cmd = [
        "docker", "run", "--rm",
        "--name", container_name,
        "--network", "none",
        "--memory", "1g",
        "--cpus", "1",
        "--pids-limit", "256",
        "-v", f"{abs_job_dir}:/work",
        "eduvision-manim",
        "manim", "-ql", "--disable_caching", "--progress_bar", "none",
        "--media_dir", "/work/media",
        "script.py", scene_name
    ]

    try:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate(timeout=timeout_s)
        return process.returncode, stdout, stderr, False
    except subprocess.TimeoutExpired:
        # Killing the docker CLI process does not kill the running container;
        # force remove the container explicitly.
        process.kill()
        process.communicate()
        try:
            subprocess.run(["docker", "rm", "-f", container_name], capture_output=True, timeout=10)
        except Exception:
            pass
        return -1, "", f"Execution timed out after {timeout_s}s", True


def _render_local(
    job_dir: str,
    scene_name: str,
    timeout_s: float
) -> tuple[int, str, str, bool]:
    """
    Run rendering locally on the host using per-job media directory.
    Returns (returncode, stdout, stderr, timed_out).
    """
    print("=" * 70)
    print("⚠️  WARNING: Running Manim in LOCAL sandbox mode.")
    print("⚠️  Untrusted code runs directly on the host! Use SANDBOX_MODE=docker in production.")
    print("=" * 70)

    scripts_dir = os.path.dirname(sys.executable)
    manim_exe = os.path.join(scripts_dir, "manim.exe") if os.name == "nt" else os.path.join(scripts_dir, "manim")
    if not os.path.exists(manim_exe):
        manim_exe = "manim"  # fallback to PATH

    script_path = os.path.join(job_dir, "script.py")
    media_dir = os.path.join(job_dir, "media")

    cmd = [
        manim_exe, "-ql", "--disable_caching", "--progress_bar", "none",
        "--media_dir", media_dir,
        script_path, scene_name
    ]

    try:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate(timeout=timeout_s)
        return process.returncode, stdout, stderr, False
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        return -1, stdout, f"Local render timed out after {timeout_s}s\n" + (stderr or ""), True


def run_manim_script(
    manim_code: str,
    scene_name: str,
    output_path: str | None = None,
    timeout_s: float = 120.0,
    job_id: str | None = None
) -> RenderResult:
    """
    Render a Manim script in an isolated per-job directory using Docker or local mode.
    Guarantees no shared media directory collisions, timeout enforcement, and clean cleanup.
    """
    start_time = time.perf_counter()
    if not job_id:
        job_id = uuid.uuid4().hex[:12]

    if not output_path:
        output_path = f"static/videos/{job_id}.mp4"

    sandbox_mode = os.getenv("SANDBOX_MODE", "docker").strip().lower()
    job_dir = tempfile.mkdtemp(prefix=f"eduvision_job_{job_id}_")

    try:
        # Write script to isolated per-job directory
        script_path = os.path.join(job_dir, "script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(manim_code)

        # Ensure destination directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Run according to selected sandbox mode
        if sandbox_mode == "docker":
            returncode, stdout, stderr, timed_out = _render_docker(job_dir, scene_name, job_id, timeout_s)
        else:
            returncode, stdout, stderr, timed_out = _render_local(job_dir, scene_name, timeout_s)

        duration_s = time.perf_counter() - start_time
        stderr_tail = _extract_stderr_tail(stderr)

        if timed_out:
            print(f"[ERROR] Job {job_id} timed out after {timeout_s}s")
            return RenderResult(
                ok=False,
                video_path=None,
                error_type="timeout",
                stderr_tail=stderr_tail or f"Rendering timed out after {timeout_s}s",
                duration_s=duration_s
            )

        if returncode != 0:
            print(f"[ERROR] Render failed with exit code {returncode}")
            # Determine error type
            lower_err = stderr.lower()
            if any(term in lower_err for term in ["failed to connect to the docker", "cannot connect to the docker", "error loading config file", "unable to find image"]):
                error_type = "sandbox_error"
            else:
                error_type = "manim_error"
            return RenderResult(
                ok=False,
                video_path=None,
                error_type=error_type,
                stderr_tail=stderr_tail,
                duration_s=duration_s
            )

        # Locate generated MP4 in isolated job media directory
        job_media = os.path.join(job_dir, "media")
        final_video = _find_rendered_mp4(job_media, scene_name)

        if not final_video:
            print(f"[ERROR] No MP4 output found in {job_media}")
            return RenderResult(
                ok=False,
                video_path=None,
                error_type="no_output",
                stderr_tail=stderr_tail or "No MP4 file produced in media output directory",
                duration_s=duration_s
            )

        # Copy to requested output_path
        shutil.copy(final_video, output_path)
        print(f"[OK] Job {job_id} successfully saved video to {output_path}")

        return RenderResult(
            ok=True,
            video_path=output_path,
            error_type=None,
            stderr_tail=stderr_tail,
            duration_s=duration_s
        )

    except Exception as e:
        duration_s = time.perf_counter() - start_time
        return RenderResult(
            ok=False,
            video_path=None,
            error_type="sandbox_error",
            stderr_tail=str(e),
            duration_s=duration_s
        )

    finally:
        # Always clean up isolated per-job directory
        try:
            shutil.rmtree(job_dir, ignore_errors=True)
        except Exception:
            pass
