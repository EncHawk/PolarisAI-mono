"""Password hashing helpers. Always store salted bcrypt hashes, never plaintext."""
from __future__ import annotations

import bcrypt


def hash_password(password: str) -> str:
    # bcrypt truncates at 72 bytes; enforce a sensible limit here to stay safe.
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except Exception:
        return False
