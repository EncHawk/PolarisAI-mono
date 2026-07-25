"""Worker entrypoint: pop jobs from `polaris:jobs` and run the langgraph pipeline."""
from __future__ import annotations

import json
import time
import traceback

from redis.exceptions import RedisError
from shared.trace import AgentName

from worker._util import load_paper_markdown, update_code_session, update_paper_status
from worker.graph import build_graph
from worker.logger import PipelineTimer
from worker.state import WorkerState
from worker.store import get_redis
from worker.traces import error, status, step


def main() -> None:
    redis = get_redis()
    app = build_graph()
    print("[polaris-worker] ready; polling polaris:jobs ...")
    while True:
        # Poll instead of BLPOP: some managed Redis proxies apply a socket
        # timeout shorter than the server-side blocking timeout, which makes an
        # idle worker report read timeouts even though PING and LPOP work.
        try:
            raw = redis.lpop("polaris:jobs")
        except RedisError as e:
            print(f"[polaris-worker] queue read failed: {e}; retrying")
            time.sleep(1)
            continue
        if raw is None:
            time.sleep(0.25)
            continue
        try:
            job = json.loads(raw)
        except Exception as e:
            print(f"[polaris-worker] bad job payload: {e}")
            continue
        try:
            run_one(app, job)
        except Exception as e:
            # A malformed job or transient persistence failure must not stop
            # the queue consumer. run_one handles normal pipeline failures.
            print(f"[polaris-worker] job {job.get('job_uuid','?')} crashed: {e}")


def run_one(app, job: dict) -> None:
    job_uuid = job["job_uuid"]
    paper_id = job.get("paper_id", "")

    timer = PipelineTimer(job_uuid)
    timer.job_start()

    status(job_uuid, "running")
    step(job_uuid, AgentName.SYSTEM, "job-start",
         tool="redis:jobs", conclusion="job picked up by worker",
         output_query=f"paper {job.get('arxiv_id','')}")

    markdown = load_paper_markdown(paper_id)
    if not markdown:
        error(job_uuid, AgentName.SYSTEM, "no markdown for paper")
        status(job_uuid, "failed")
        update_paper_status(paper_id, "failed", {"error": "no markdown"})
        update_code_session(job_uuid, "failed")
        timer.job_end("failed", error="no markdown")
        return

    state: WorkerState = {
        "job_uuid": job_uuid,
        "paper_id": paper_id,
        "user_id": job.get("user_id", ""),
        "arxiv_id": job.get("arxiv_id", ""),
        "top_n_citations": int(job.get("top_n_citations", 8)),
        "repo_name": job.get("repo_name", ""),
        "github_url": job.get("github_url", ""),
        "repo_exists": bool(job.get("repo_exists", False)),
        "execution_mode": job.get("execution_mode", "create"),
        "markdown": markdown,
        "iteration": {},
        "runs": {},
        "history": [],
        "status": "queued",
        "error": None,
        "timer": timer,
    }
    try:
        final = app.invoke(state, config={"recursion_limit": 200})
    except Exception as e:
        tb = traceback.format_exc(limit=6)
        error(job_uuid, AgentName.SYSTEM, f"pipeline crashed: {e}\n{tb}")
        status(job_uuid, "failed")
        update_paper_status(paper_id, "failed", {"error": str(e)})
        update_code_session(job_uuid, "failed")
        timer.job_end("failed", error=str(e))
        return

    if final.get("error"):
        error(job_uuid, AgentName.SYSTEM, str(final["error"]))
        status(job_uuid, "failed")
        update_paper_status(paper_id, "failed", {"error": str(final["error"])})
        update_code_session(job_uuid, "failed", {"github_url": final.get("code", {}).get("github_url")})
        timer.job_end("failed", error=str(final["error"]))
    elif final.get("code", {}).get("push_error"):
        push_error = str(final["code"]["push_error"])
        error(job_uuid, AgentName.CODE, push_error)
        status(job_uuid, "failed")
        update_paper_status(paper_id, "failed", {"error": push_error})
        update_code_session(job_uuid, "failed", {
            "github_url": final.get("code", {}).get("github_url"),
        })
        timer.job_end("failed", error=push_error)
    else:
        status(job_uuid, "done")
        update_paper_status(paper_id, "done",
                            {"code_files": json.dumps(final.get("code", {}).get("files", []))[:100000]})
        update_code_session(job_uuid, "completed", {
            "github_url": final.get("code", {}).get("github_url"),
        })
        timer.job_end("done")
    step(job_uuid, AgentName.SYSTEM, "job-end",
         tool="graph", conclusion="pipeline finished",
         output_query=final.get("status", "done"))


if __name__ == "__main__":
    main()
