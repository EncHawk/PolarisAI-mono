"""Daytona sandbox client used by the CODE agent.

Uses the maintained `daytona` package (the `daytona_sdk` package is deprecated).
Reuses an existing sandbox identified by `DAYTONA_SANDBOX_NAME` (default "Polaris"),
so we do NOT create a fresh sandbox per run -- you must have one running on
app.daytona.io (or your own Daytona server) and pass its name + creds.

Fallback: when Daytona creds are missing entirely, we degrade to a local tempdir
"sandbox" so the graph still runs end-to-end in dev without burning real sandboxes.
"""
from __future__ import annotations

import base64
import shlex
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from worker.config import get_settings


@dataclass
class SandboxResult:
    stdout: str = ""
    stderr: str = ""
    returncode: int = 0


@dataclass
class Sandbox:
    """Minimal sandbox abstraction: write_file, exec, cleanup."""
    workdir: str
    files: dict[str, str] = field(default_factory=dict)
    _real: Any | None = None   # underlying Sandbox object if Daytona-backed
    _is_real: bool = False
    _owned: bool = False       # did we create this sandbox (and thus should remove it)?

    @property
    def is_real(self) -> bool:
        return self._is_real

    @classmethod
    def create(cls, job_id: str = "") -> Sandbox:
        s = get_settings()
        if s.DAYTONA_API_KEY and s.DAYTONA_API_URL:
            try:
                return cls._attach_real(s, job_id)
            except Exception as e:
                # fall through to local
                print(f"[daytona] could not attach ({e!r}); falling back to local sandbox")
        workdir = tempfile.mkdtemp(prefix=f"polaris-sbx-{job_id}-")
        return cls(workdir=workdir, _is_real=False)

    @classmethod
    def _attach_real(cls, s, job_id: str) -> Sandbox:
        import warnings

        from daytona import Daytona, DaytonaConfig  # type: ignore[import-not-found]
        warnings.filterwarnings("ignore", category=DeprecationWarning)

        cfg = DaytonaConfig(
            api_key=s.DAYTONA_API_KEY,
            api_url=s.DAYTONA_API_URL,
            target=s.DAYTONA_TARGET or "global",
        )
        client = Daytona(cfg)
        # reuse the named sandbox rather than creating (create() fails on app.daytona.io
        # without an explicit region, and reusing is cheaper + idempotent)
        sbx = client.get(s.DAYTONA_SANDBOX_NAME)
        if str(sbx.state).endswith("STOPPED"):
            client.start(sbx)

        # isolate each job in its own sub-directory so papers never clobber each other
        base = s.DAYTONA_WORKDIR or "/home/daytona"
        safe_id = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in job_id).strip("-").lower()
        if not safe_id:
            safe_id = "default"
        workdir = f"{base.rstrip('/')}/{safe_id}"
        # start from a clean slate for this job; use base as cwd so rm/mkdir always work
        tmp = cls(workdir=base, _real=sbx, _is_real=True, _owned=False)
        tmp.exec(f"rm -rf {shlex.quote(workdir)} && mkdir -p {shlex.quote(workdir)}", timeout=30)
        return cls(workdir=workdir, _real=sbx, _is_real=True, _owned=False)

    def _abs(self, path: str) -> str:
        if path.startswith("/"):
            abs_path = path
        else:
            abs_path = f"{self.workdir.rstrip('/')}/{path}"
        # ensure the leading directory exists in the sandbox
        self.exec(f"mkdir -p {shlex.quote(self._dirname(abs_path))}", timeout=10)
        return abs_path

    @staticmethod
    def _dirname(p: str) -> str:
        idx = p.rfind("/")
        return p[:idx] if idx > 0 else "/"

    def write_file(self, path: str, contents: str) -> str:
        self.files[path] = contents
        if not self._is_real:
            p = Path(self.workdir) / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(contents)
            return str(p)
        abs_path = self._abs(path)
        # write via heredoc through exec (one round-trip; handles any content)
        heredoc = (
            f"mkdir -p {shlex.quote(self._dirname(abs_path))} && "
            f"cat > {shlex.quote(abs_path)} <<'POLARIS_EOF'\n{contents}\nPOLARIS_EOF"
        )
        self.exec(heredoc, timeout=120)
        return abs_path

    def write_binary_file(self, path: str, data: bytes) -> str:
        """Write a binary file by base64-encoding through the shell."""
        self.files[path] = "<binary>"
        if not self._is_real:
            p = Path(self.workdir) / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            return str(p)
        abs_path = self._abs(path)
        b64 = base64.b64encode(data).decode("ascii")
        self.exec(
            f"mkdir -p {shlex.quote(self._dirname(abs_path))} && "
            f"printf '%s' {shlex.quote(b64)} | base64 -d > {shlex.quote(abs_path)}",
            timeout=120,
        )
        return abs_path

    def exec(self, cmd: str, timeout: int = 600) -> SandboxResult:
        if not self._is_real:
            try:
                proc = subprocess.run(
                    cmd, shell=True, cwd=self.workdir,
                    capture_output=True, text=True, timeout=timeout,
                )
            except subprocess.TimeoutExpired as e:
                stdout = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else str(e.stdout or "")
                return SandboxResult(stdout=stdout, stderr="timeout", returncode=124)
            return SandboxResult(stdout=proc.stdout, stderr=proc.stderr, returncode=proc.returncode)
        try:
            r = self._real.process.exec(cmd, cwd=self.workdir, timeout=timeout)
        except Exception as e:
            return SandboxResult(stderr=f"daytona exec error: {e}", returncode=1)
        # `r.result` holds combined stdout, `r.exit_code` is the rc
        stdout = getattr(r, "result", "") or ""
        if not stdout and r.artifacts and getattr(r.artifacts, "stdout", None):
            stdout = r.artifacts.stdout
        rc = int(getattr(r, "exit_code", 0) or 0)
        return SandboxResult(stdout=stdout, stderr="", returncode=rc)

    def prepare_git(self, remote_url: str, token: str, existing: bool) -> SandboxResult:
        """Initialize/checkout the repo inside the sandbox using an askpass file."""
        askpass = f"{self.workdir.rstrip('/')}/.polaris_git_askpass"
        script = (
            "#!/bin/sh\n"
            "case \"$1\" in\n"
            "  *Username*) printf '%s\\n' polaris-bot ;;\n"
            f"  *) printf '%s\\n' {shlex.quote(token)} ;;\n"
            "esac\n"
        )
        self.write_file(".polaris_git_askpass", script)
        self.exec(f"chmod 700 {shlex.quote(askpass)}", timeout=10)
        env = (
            f"export GIT_ASKPASS={shlex.quote(askpass)} "
            "GIT_TERMINAL_PROMPT=0 GIT_AUTHOR_NAME=Polaris GIT_AUTHOR_EMAIL=bot@polaris.local "
            "GIT_COMMITTER_NAME=Polaris GIT_COMMITTER_EMAIL=bot@polaris.local; "
        )
        init = self.exec(f"{env}git init -b main", timeout=30)
        if init.returncode != 0:
            return init
        remote = self.exec(
            f"{env}git remote remove origin >/dev/null 2>&1 || true; "
            f"{env}git remote add origin {shlex.quote(remote_url)}",
            timeout=30,
        )
        if remote.returncode != 0 or not existing:
            return remote
        return self.exec(
            f"{env}git fetch --depth=1 origin main && "
            f"{env}git checkout -B main origin/main",
            timeout=180,
        )

    def publish_git(self, token: str, commit_message: str) -> SandboxResult:
        """Commit and push files from inside the sandbox; token never enters the remote URL."""
        askpass = f"{self.workdir.rstrip('/')}/.polaris_git_askpass"
        env = (
            f"export GIT_ASKPASS={shlex.quote(askpass)} "
            "GIT_TERMINAL_PROMPT=0 GIT_AUTHOR_NAME=Polaris GIT_AUTHOR_EMAIL=bot@polaris.local "
            "GIT_COMMITTER_NAME=Polaris GIT_COMMITTER_EMAIL=bot@polaris.local; "
        )
        result = self.exec(
            f"{env}git add -A -- ':!.polaris_git_askpass' && "
            f"({env}git diff --cached --quiet || {env}git commit -m {shlex.quote(commit_message)}) && "
            f"{env}git push -u origin HEAD:main",
            timeout=300,
        )
        self.exec(f"rm -f {shlex.quote(askpass)}", timeout=10)
        return result

    def cleanup(self) -> None:
        """Remove the per-job workdir from the shared sandbox to avoid cross-paper leakage."""
        if self._is_real:
            self.exec(f"rm -rf {shlex.quote(self.workdir)}", timeout=30)
