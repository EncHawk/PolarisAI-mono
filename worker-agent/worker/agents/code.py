"""CODE agent.

Builds the PyTorch / raw-Python implementation in a Daytona sandbox, file-by-file.
Files do one thing each.  Runs commands, reads logs, loops until self-satisfied.

Uses plain chat completions (not structured output) because DeepInfra's structured
output endpoint can hang on very large file schemas.  The model returns a JSON
metadata block plus a code block per file, both in markdown fences.
"""
from __future__ import annotations

import json
import re
import time as _time
from dataclasses import dataclass, field

from langchain_core.prompts import ChatPromptTemplate
from shared.trace import AgentName

from worker._util import update_paper_status
from worker.config import get_settings
from worker.models import make_llm
from worker.state import WorkerState, mark_agent_run
from worker.tools.daytona_sandbox import Sandbox
from worker.tools.github import GitHubRepository
from worker.traces import output, status, step


@dataclass
class Iteration:
    files: list[dict] = field(default_factory=list)
    notes: str = ""
    ready: bool = False
    output_query: str = ""


SYSTEM = """You are the CODE agent for an automated paper-reproduction pipeline.
Implement the paper's claim in PyTorch (or raw Python where the paper specifies).
Rules:
- Each file does ONE thing only (no mega-files).
- Pure PyTorch / raw Python; no exotic deps unless the paper forces it.
- Provide a runnable entry-point (e.g. `reproduce.py`) and an install step in notes.
- Generate a `README.md` with a good-looking overview, install/run instructions, and a results summary.
- The README MUST link to the paper's arXiv URL (https://arxiv.org/abs/<arxiv_id>).
- Use the plan below as a guide; build a minimal but complete reproduction.

Output format (exactly):

```json
{{
  "notes": "pip install torch ... ; run with: python reproduce.py",
  "ready": false,
  "output_query": "one sentence on what to fix next",
  "files": [
    {{"path": "reproduce.py", "description": "entry point"}},
    {{"path": "src/model.py", "description": "..."}}
  ]
}}
```

Then for **every** file listed above, emit a code block with the path in the fence:

```python:reproduce.py
<contents>
```

```python:src/model.py
<contents>
```

Set `ready=true` only when the code runs end-to-end and reproduces the paper's key claims.
You will receive the previous run logs so you can iterate.
"""


def _parse_iteration(text: str) -> Iteration:
    """Parse markdown output into an Iteration object."""
    text = text.strip()
    if text.startswith("```"):
        text = text[text.find("\n"):]
    if text.endswith("```"):
        text = text[:text.rfind("```")]
    text = text.strip()

    # Find the JSON metadata block
    meta: dict = {}
    json_match = re.search(r"```json\n(.*?)\n```", text, re.DOTALL)
    if json_match:
        try:
            meta = json.loads(json_match.group(1))
        except json.JSONDecodeError:
            # try to find any JSON object in the text
            obj_match = re.search(r"\{[\s\S]*?\"ready\"[\s\S]*?\}", text)
            if obj_match:
                try:
                    meta = json.loads(obj_match.group(0))
                except json.JSONDecodeError:
                    pass

    files: list[dict] = []
    # Code blocks with path in the fence: ```python:path/to/file.py
    for m in re.finditer(r"```(?:python)?:(.+?)\n(.*?)\n```", text, re.DOTALL):
        path = m.group(1).strip()
        contents = m.group(2)
        files.append({"path": path, "contents": contents})

    # Fallback: plain ```python blocks without a path - skip, or assign a default name
    # if no path blocks were found
    if not files:
        for m in re.finditer(r"```python\n(.*?)\n```", text, re.DOTALL):
            files.append({"path": "snippet.py", "contents": m.group(1)})

    return Iteration(
        files=files,
        notes=str(meta.get("notes", "")),
        ready=bool(meta.get("ready", False)),
        output_query=str(meta.get("output_query", "")),
    )


def _generate_readme(llm, arxiv_id: str, repo_name: str, files: list[dict]) -> str:
    """Generate a fallback README when the model forgets to include one."""
    from langchain_core.prompts import ChatPromptTemplate
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a technical writer. Write a concise, good-looking README.md for a GitHub repo that reproduces a research paper."),
        ("human", "Paper: https://arxiv.org/abs/{arxiv_id}\nRepo: {repo_name}\nFiles:\n{files}\n\nOutput only the README markdown."),
    ])
    try:
        raw = llm.invoke(prompt.format_messages(
            arxiv_id=arxiv_id,
            repo_name=repo_name,
            files="\n".join(f"- {f['path']}" for f in files),
        ))
        return str(getattr(raw, "content", raw)).strip()
    except Exception as e:
        return f"# {repo_name}\n\nPolaris AI reproduction of [arXiv:{arxiv_id}](https://arxiv.org/abs/{arxiv_id}).\n\nSee the source files in this repository.\n"


def build_prompt():
    return ChatPromptTemplate.from_messages([
        ("system", SYSTEM),
        ("human", "ARXIV PAPER: https://arxiv.org/abs/{arxiv_id}\n\n"
                  "PLAN:\n{plan}\n\nREAD (context):\n{read}\n\n"
                  "FEEDBACK/LOGS so far:\n{logs}\n\nLatest draft:\n{draft}"),
    ])


def run_code(state: WorkerState) -> dict:
    job_uuid = state["job_uuid"]
    paper_id = state.get("paper_id", "")
    runs = mark_agent_run(state, "CODE")
    update_paper_status(paper_id, "coding")
    status(job_uuid, "coding")
    s = get_settings()

    llm = make_llm("CODE", job_uuid)
    prompt = build_prompt()

    plan = state.get("plan") or {}
    read = state.get("read") or {}
    plan_blob = json.dumps(plan, indent=2)[:8000]
    read_blob = json.dumps({"aim": read.get("aim"), "novel_approach": read.get("novel_approach"),
                            "numbers": read.get("numbers")}, indent=2)[:4000]

    sandbox = Sandbox.create(job_id=job_uuid)
    repo = GitHubRepository()
    repo_name = state.get("repo_name") or f"paper-{state.get('arxiv_id', 'unknown')}"
    execution_mode = state.get("execution_mode") or "create"
    existing = bool(state.get("repo_exists")) or execution_mode in {"modify", "run"}
    github_url = state.get("github_url") or repo.html_url(repo_name)
    accumulated_logs: list[dict] = []
    draft: Iteration | None = None
    push_error = ""

    if existing:
        try:
            remote = repo.ensure(repo_name)
            github_url = remote.get("html_url") or github_url
            prepared = sandbox.prepare_git(remote["clone_url"], repo.token, existing=True)
            step(job_uuid, AgentName.CODE, "repo-checkout",
                 tool="github+daytona", conclusion=f"checked out {repo_name} rc={prepared.returncode}",
                 output_query=github_url)
            if prepared.returncode != 0:
                return {"code": {"repo_name": repo_name, "github_url": github_url,
                                  "push_error": prepared.stderr or prepared.stdout or "repo checkout failed"},
                        "runs": runs}
        except Exception as e:
            return {"code": {"repo_name": repo_name, "github_url": github_url,
                              "push_error": f"repo checkout failed: {e}"}, "runs": runs}

    if execution_mode == "run":
        run = sandbox.exec("python reproduce.py")
        step(job_uuid, AgentName.CODE, "run-existing-repo",
             tool="daytona", conclusion=f"rc={run.returncode} {run.stderr[:160] or run.stdout[:160]}",
             output_query="python reproduce.py")
        output(job_uuid, AgentName.CODE,
               conclusion=f"existing repo run rc={run.returncode}",
               output_query=github_url)
        sandbox.cleanup()
        return {"code": {
            "files": [], "run_logs": [{"step": "run-existing", "stdout": run.stdout[:3000],
                                         "stderr": run.stderr[:3000]}],
            "notes": "Ran the existing repository without modifying it.",
            "ready": run.returncode == 0, "output_query": github_url,
            "github_url": github_url, "repo_name": repo_name,
            "push_error": "" if run.returncode == 0 else (run.stderr or "existing repo failed"),
        }, "runs": runs}

    for i in range(s.AGENT_MAX_STEPS):
        step(job_uuid, AgentName.CODE, f"code-iter-{i+1}",
             tool="daytona" if sandbox.is_real else "sandbox:local",
             conclusion=f"{len(draft.files) if draft else 0} files, " f"{len(accumulated_logs)} logs",
             output_query=(draft.output_query if draft else "scaffold files"))
        try:
            raw = llm.invoke(prompt.format_messages(
                arxiv_id=state.get("arxiv_id", ""),
                plan=plan_blob,
                read=read_blob,
                logs=json.dumps(accumulated_logs, indent=2)[:8000],
                draft=(draft.notes if draft else "(none)"),
            ))
            text = str(getattr(raw, "content", raw))
            draft = _parse_iteration(text)
        except Exception as e:
            step(job_uuid, AgentName.CODE, f"code-iter-{i+1}-failed",
                 tool="llm:DeepInfra(OpenAI)", conclusion=f"call failed: {e}")
            break

        # write all files into the sandbox
        for f in draft.files:
            sandbox.write_file(f["path"], f["contents"])
        step(job_uuid, AgentName.CODE, f"code-iter-{i+1}-write",
             tool="daytona" if sandbox.is_real else "sandbox:local",
             conclusion=f"wrote {len(draft.files)} files: "
                       + ", ".join(f["path"] for f in draft.files)[:200])

        # extract the actual python command from notes
        cmd = "python reproduce.py"
        if draft.notes:
            for line in draft.notes.splitlines():
                low = line.lower()
                if "python" not in low:
                    continue
                m = re.search(r"\bpython\b", line, re.IGNORECASE)
                if m:
                    candidate = line[m.start():].strip().strip("`").strip()
                    if candidate:
                        cmd = candidate
                        break

        t_run = _time.perf_counter()
        run = sandbox.exec(cmd)
        dt_run = round(_time.perf_counter() - t_run, 2)
        log = {"step": f"run-{i+1}", "stdout": run.stdout[:3000], "stderr": run.stderr[:3000]}
        accumulated_logs.append(log)
        step(job_uuid, AgentName.CODE, f"code-iter-{i+1}-run",
             tool="daytona" if sandbox.is_real else "sandbox:local",
             conclusion=f"rc={run.returncode} " + (run.stderr[:160] or run.stdout[:160]),
             output_query=cmd)
        timer = state.get("timer")
        if timer:
            timer.code_run(f"run-{i+1}", run.returncode, dt_run)
        output(job_uuid, AgentName.CODE,
               conclusion=f"iter {i+1}: {len(draft.files)} files, rc={run.returncode}, "
                         f"ready={draft.ready}",
               output_query=draft.output_query)
        if draft.ready or i == s.AGENT_MAX_STEPS - 1:
            break

    if draft is None:
        push_error = "code produced no output"
    else:
        # Ensure every repo has a README.md linking back to the paper
        paths = {f["path"] for f in draft.files}
        if "README.md" not in paths:
            readme = _generate_readme(llm, state.get("arxiv_id", ""), repo_name, draft.files)
            sandbox.write_file("README.md", readme)
            draft.files.append({"path": "README.md", "contents": readme})
            step(job_uuid, AgentName.CODE, "readme-injected",
                 tool="llm:DeepInfra(OpenAI)", conclusion="generated README.md because model omitted it",
                 output_query="README.md")
        try:
            remote = repo.ensure(repo_name, description=f"Polaris reproduction for arXiv {state.get('arxiv_id', '')}")
            github_url = remote.get("html_url") or github_url
            if not existing:
                prepared = sandbox.prepare_git(remote["clone_url"], repo.token, existing=False)
                if prepared.returncode != 0:
                    push_error = prepared.stderr or prepared.stdout or "repo initialization failed"
            if not push_error:
                pushed = sandbox.publish_git(repo.token, f"Polaris reproduction for arXiv {state.get('arxiv_id', '')}")
                step(job_uuid, AgentName.CODE, "repo-push",
                     tool="github+daytona", conclusion=f"pushed {repo_name} rc={pushed.returncode}",
                     output_query=github_url)
                if pushed.returncode != 0:
                    push_error = pushed.stderr or pushed.stdout or "repo push failed"
        except Exception as e:
            push_error = f"repo publish failed: {e}"
            step(job_uuid, AgentName.CODE, "repo-push-failed",
                 tool="github+daytona", conclusion=push_error, output_query=github_url)

    sandbox.cleanup()

    files = draft.files if draft else []
    run_logs = [{"step": lg["step"], "stdout": lg["stdout"], "stderr": lg["stderr"]} for lg in accumulated_logs]
    return {"code": {"files": files, "run_logs": run_logs,
                     "notes": (draft.notes if draft else ""),
                     "ready": draft.ready if draft else False,
                     "output_query": draft.output_query if draft else "code produced no output",
                     "github_url": github_url, "repo_name": repo_name,
                     "push_error": push_error},
            "runs": runs}
