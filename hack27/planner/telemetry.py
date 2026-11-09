import os
import json
import time
from datetime import datetime, timezone
import threading
from typing import List, Dict, Any, Optional

_LOG_LOCK = threading.Lock()


def log_job_telemetry(
    job_id: str,
    prompt: str,
    status: str,
    attempts: int,
    per_attempt: List[Dict[str, Any]],
    total_latency_s: float,
    error_type: Optional[str] = None,
    token_usage: Optional[Dict[str, Any]] = None,
    log_file: Optional[str] = None
) -> None:
    """
    Append a single JSON line recording job telemetry to hack27/logs/jobs.jsonl.
    Completely dependency-free, thread-safe, and resilient.
    """
    if not log_file:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        log_dir = os.path.join(base_dir, "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, "jobs.jsonl")
    else:
        log_dir = os.path.dirname(os.path.abspath(log_file))
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "job_id": job_id,
        "prompt": prompt,
        "status": status,
        "error_type": error_type,
        "attempts": attempts,
        "per_attempt": per_attempt,
        "total_latency_s": round(total_latency_s, 3),
        "token_usage": token_usage or {}
    }

    line = json.dumps(record) + "\n"

    with _LOG_LOCK:
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(line)
        except Exception as e:
            print(f"[WARN] Failed to write telemetry to {log_file}: {e}")

