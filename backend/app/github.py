"""Small GitHub REST client used for duplicate detection and repo previews."""
from __future__ import annotations

from urllib.parse import quote

import httpx

from app.config import get_settings


class GitHubUnavailable(RuntimeError):
    pass


class GitHubClient:
    def __init__(self) -> None:
        s = get_settings()
        if not s.GITHUB_ACCESS_TOKEN:
            raise GitHubUnavailable("GITHUB_ACCESS_TOKEN is not configured")
        self.org = s.GITHUB_ORG
        self.base_url = s.GITHUB_API_URL.rstrip("/")
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {s.GITHUB_ACCESS_TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _repo_path(self, repo_name: str) -> str:
        return f"/repos/{quote(self.org, safe='')}/{quote(repo_name, safe='')}"

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code in {401, 403}:
            raise GitHubUnavailable(
                "GitHub rejected the configured credential; verify the token and "
                "its Polaris-Implementations organisation permissions"
            )
        response.raise_for_status()

    def repository(self, repo_name: str) -> dict | None:
        response = httpx.get(
            f"{self.base_url}{self._repo_path(repo_name)}",
            headers=self.headers,
            timeout=15.0,
        )
        if response.status_code == 404:
            return None
        self._raise_for_status(response)
        return response.json()

    def contents(self, repo_name: str) -> list[dict]:
        response = httpx.get(
            f"{self.base_url}{self._repo_path(repo_name)}/contents",
            headers=self.headers,
            timeout=15.0,
        )
        self._raise_for_status(response)
        rows = response.json()
        if isinstance(rows, dict):
            return [rows]
        return [
            {
                "name": row.get("name", ""),
                "path": row.get("path", ""),
                "type": row.get("type", ""),
                "html_url": row.get("html_url", ""),
                "download_url": row.get("download_url", ""),
            }
            for row in rows
        ]

    def preview(self, repo_name: str) -> tuple[dict | None, list[dict]]:
        repo = self.repository(repo_name)
        return (None, []) if repo is None else (repo, self.contents(repo_name))
