"""
app/core/security.py
=====================
Security utilities module.

Authentication has been removed from this platform.
This module is retained for any future security utilities (e.g., API key support).

SSRF protection is in app/core/ssrf.py.
"""

from __future__ import annotations

# This module is intentionally minimal.
# All auth (JWT, bcrypt, OAuth2) has been removed.
# SSRF protection is in app.core.ssrf.
#
# If API key or other auth is added in the future, place it here.

def hash_password(password: str) -> str:
    return f"hashed_{password}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hashed_password in (f"hashed_{plain_password}", plain_password)

def create_access_token(subject: str, role: str = "ADMIN", expires_delta: any = None) -> str:
    return f"mock-token-{subject}-{role}"

class CurrentTokenData:
    def __init__(self, user_id: str = "test-user", role: str = "ADMIN", email: str = "admin@example.com"):
        self.user_id = user_id
        self.role = role
        self.email = email

def require_roles(*roles: str):
    def dependency():
        return CurrentTokenData()
    return dependency
