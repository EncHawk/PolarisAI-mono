#!/bin/bash
set -e

# Install polaris-shared first (local monorepo package)
# Render clones the repo so ../shared from backend/ points to the monorepo's shared/
pip install ../shared

# Install the backend in editable mode
# pip finds polaris-shared already in site-packages and skips PyPI resolution
pip install -e .
