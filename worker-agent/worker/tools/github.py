"""GitHub repo provisioning; file transfer and git push happen in Sandbox."""
from __future__ import annotations

from urllib.parse import quote

import httpx

from worker.config import get_settings


class GitHubRepository:
    def __init__(self) -> None:
        s = get_settings()
        if not s.GITHUB_ACCESS_TOKEN:
            raise RuntimeError("GITHUB_ACCESS_TOKEN is not configured")
        self.token = s.GITHUB_ACCESS_TOKEN
        self.org = s.GITHUB_ORG
        self.base_url = s.GITHUB_API_URL.rstrip("/")
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.org}"

    def _repo_url(self, repo_name: str) -> str:
        return f"{self.base_url}/repos/{quote(self.org, safe='')}/{quote(repo_name, safe='')}"

    def html_url(self, repo_name: str) -> str:
        return f"https://github.com/{self.org}/{repo_name}"

    def ensure(self, repo_name: str, description: str = "Polaris paper reproduction") -> dict:
        response = httpx.get(self._repo_url(repo_name), headers=self.headers, timeout=15.0)
        if response.status_code == 200:
            return response.json()
        if response.status_code != 404:
            response.raise_for_status()

        create = httpx.post(
            f"{self.base_url}/orgs/{quote(self.org, safe='')}/repos",
            headers=self.headers,
            json={
                "name": repo_name,
                "description": description,
                "private": get_settings().GITHUB_REPO_PRIVATE,
                "has_issues": False,
                "has_projects": False,
                "has_wiki": False,
            },
            timeout=15.0,
        )
        # A concurrent worker may have created it after our initial GET.
        if create.status_code == 422:
            response = httpx.get(self._repo_url(repo_name), headers=self.headers, timeout=15.0)
            response.raise_for_status()
            return response.json()
        create.raise_for_status()
        return create.json()
