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
