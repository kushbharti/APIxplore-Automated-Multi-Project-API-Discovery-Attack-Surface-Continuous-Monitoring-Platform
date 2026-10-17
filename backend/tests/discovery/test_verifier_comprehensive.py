"""
Comprehensive regression tests for endpoint discovery, verification, URL handling, and monitoring pipeline.
Covers:
- JSON APIs (200, 201, 204, text/plain with JSON, XML)
- HTML pages (ordinary web pages)
- HTML error pages & SPA fallbacks (SPA catch-all router with HTTP 200)
- Redirects (API redirect, login page redirect, landing page redirect, redirect loop)
- Non-destructive probing & 405 Method Not Allowed verification
- Shared frontend/backend domains vs. separately hosted backends
- Monitoring registration filtering
- Health checker verification against SPA fallbacks and login redirects
"""

from __future__ import annotations

import httpx
import pytest

from app.discovery.verifier import (
    _classify_verification,
    _is_spa_fallback,
    _is_html_error_page,
    _is_auth_redirect,
    _is_home_redirect,
    verify_endpoint,
)
from app.discovery.javascript import _extract_from_js, _should_skip_path
from app.models.endpoint import Endpoint
from app.monitoring.checker import run_check


# ---------------------------------------------------------------------------
# 1. JSON APIs Verification Tests
# ---------------------------------------------------------------------------
class TestJsonApiVerification:
    def test_json_200_verified(self):
        status, note = _classify_verification(
            http_status=200,
            content_type="application/json; charset=utf-8",
            body_sample='{"users": [{"id": 1, "name": "Alice"}]}',
            url="https://api.example.com/v1/users",
        )
        assert status == "VERIFIED"
        assert "application/json" in (note or "")

    def test_json_201_created_verified(self):
        status, note = _classify_verification(
            http_status=201,
            content_type="application/json",
            body_sample='{"status": "created", "id": 123}',
            url="https://api.example.com/v1/users",
            method="POST",
        )
        assert status == "VERIFIED"

    def test_204_no_content_verified(self):
        status, note = _classify_verification(
            http_status=204,
            content_type="",
            body_sample="",
            url="https://api.example.com/v1/items/42",
            method="DELETE",
        )
        assert status == "VERIFIED"
        assert "204" in (note or "")

    def test_text_plain_with_valid_json_body(self):
        status, note = _classify_verification(
            http_status=200,
            content_type="text/plain",
            body_sample='{"result": "ok", "count": 10}',
            url="https://api.example.com/status",
        )
        assert status == "VERIFIED"
        assert "JSON" in (note or "")

    def test_xml_api_verified(self):
        status, note = _classify_verification(
            http_status=200,
            content_type="application/xml",
            body_sample='<response><status>ok</status></response>',
            url="https://api.example.com/v1/feed.xml",
        )
        assert status == "VERIFIED"

    def test_problem_json_error_verified(self):
        status, note = _classify_verification(
            http_status=422,
            content_type="application/problem+json",
            body_sample='{"type": "validation-error", "detail": "Missing param"}',
            url="https://api.example.com/v1/checkout",
            method="POST",
        )
        assert status == "VERIFIED"
        assert "validation error" in (note or "").lower()


# ---------------------------------------------------------------------------
# 2. HTML Pages (Ordinary Web Pages) Tests
# ---------------------------------------------------------------------------
class TestHtmlPageClassification:
    def test_ordinary_webpage_classified_as_web_page(self):
        html_doc = """<!DOCTYPE html>
        <html lang="en">
        <head><title>Example Domain</title></head>
        <body><h1>Welcome to our home page</h1><p>Some text</p></body>
        </html>"""
        status, note = _classify_verification(
            http_status=200,
            content_type="text/html; charset=UTF-8",
            body_sample=html_doc,
            url="https://example.com/about",
        )
        assert status == "WEB_PAGE"
        assert "Ordinary HTML webpage" in (note or "")

    def test_frontend_route_not_assumed_api(self):
        html_doc = "<html><body><nav><a href='/pricing'>Pricing</a></nav></body></html>"
        status, note = _classify_verification(
            http_status=200,
            content_type="text/html",
            body_sample=html_doc,
            url="https://example.com/dashboard",
        )
        assert status == "WEB_PAGE"


# ---------------------------------------------------------------------------
# 3. HTML Error Pages & SPA Fallback Tests
# ---------------------------------------------------------------------------
class TestHtmlErrorAndSpaFallback:
    def test_spa_catch_all_fallback_on_api_route(self):
        """
        When Nginx/Vite try_files $uri /index.html serves index.html with 200 OK
        for an unknown /api/ route, it must NOT be classified as VERIFIED!
        """
        spa_index_html = """<!doctype html>
        <html lang="en">
          <head><title>App UI</title></head>
          <body>
            <div id="root"></div>
            <script type="module" src="/assets/index-D8x2.js"></script>
          </body>
        </html>"""
        assert _is_spa_fallback(spa_index_html) is True

        status, note = _classify_verification(
            http_status=200,
            content_type="text/html",
            body_sample=spa_index_html,
            url="https://example.com/api/v1/nonexistent-endpoint",
        )
        assert status == "WEB_PAGE"
        assert "SPA fallback" in (note or "")

    def test_masked_html_error_page_with_http_200(self):
        """Server returns 200 OK with an HTML error page."""
        error_html = """<!DOCTYPE html>
        <html>
        <head><title>502 Bad Gateway</title></head>
        <body><h1>502 Bad Gateway</h1><p>Reverse proxy error</p></body>
        </html>"""
        assert _is_html_error_page(error_html) is True

        status, note = _classify_verification(
            http_status=200,
            content_type="text/html",
            body_sample=error_html,
            url="https://example.com/api/v1/data",
        )
        assert status == "UNAVAILABLE"
        assert "HTML error page" in (note or "")

    def test_500_html_error_page(self):
        error_html = "<html><head><title>500 Internal Server Error</title></head><body><h1>Internal Server Error</h1></body></html>"
        status, note = _classify_verification(
            http_status=500,
            content_type="text/html",
            body_sample=error_html,
            url="https://example.com/api/v1/broken",
        )
        assert status == "UNAVAILABLE"

    def test_404_not_found(self):
        status, note = _classify_verification(
            http_status=404,
            content_type="application/json",
            body_sample='{"error": "Not Found"}',
            url="https://example.com/api/v1/missing",
        )
        assert status == "UNAVAILABLE"


# ---------------------------------------------------------------------------
# 4. Redirects and Redirect History Tests
# ---------------------------------------------------------------------------
class TestRedirectHandling:
    def test_api_redirect_to_auth_page(self):
        """Probing an API path redirects to an HTML login page -> AUTH_REQUIRED."""
        assert _is_auth_redirect("https://example.com/login?redirect=/api/v1/profile") is True
        assert _is_auth_redirect("https://auth.example.com/oauth/authorize") is True

        status, note = _classify_verification(
            http_status=200,
            content_type="text/html",
            body_sample="<html><body><form action='/login'><input type='password'></form></body></html>",
            url="https://example.com/api/v1/profile",
            redirect_count=1,
            final_url="https://example.com/login?redirect=/api/v1/profile",
        )
        assert status == "AUTH_REQUIRED"
        assert "Redirected (1 hops) to authentication page" in (note or "")

    def test_api_redirect_to_home_landing_page(self):
        """Probing an invalid API path redirects to the home page -> WEB_PAGE."""
        assert _is_home_redirect("https://example.com/api/missing", "https://example.com/") is True

        status, note = _classify_verification(
            http_status=200,
            content_type="text/html",
            body_sample="<html><body><h1>Home</h1></body></html>",
            url="https://example.com/api/missing",
            redirect_count=1,
            final_url="https://example.com/",
        )
        assert status == "WEB_PAGE"
        assert "Redirected (1 hops) to landing page" in (note or "")

    def test_canonical_api_redirect_verified(self):
        """Probing HTTP redirects to HTTPS on same API path with JSON -> VERIFIED."""
        status, note = _classify_verification(
            http_status=200,
            content_type="application/json",
            body_sample='[{"id": 1}]',
            url="http://api.example.com/v1/items",
            redirect_count=1,
            final_url="https://api.example.com/v1/items",
        )
        assert status == "VERIFIED"


# ---------------------------------------------------------------------------
# 5. Non-Destructive Probing & 405 Method Not Allowed Tests
# ---------------------------------------------------------------------------
class TestNonDestructiveProbing:
    def test_post_endpoint_probed_with_get_returning_405(self):
        """
        Probing POST /api/v1/orders with GET returns 405 Method Not Allowed.
        Confirms the route exists for POST!
        """
        status, note = _classify_verification(
            http_status=405,
            content_type="application/json",
            body_sample='{"detail": "Method Not Allowed"}',
            url="https://example.com/api/v1/orders",
            method="POST",
        )
        assert status == "VERIFIED"
        assert "405" in (note or "")
        assert "POST" in (note or "")

    def test_put_endpoint_probed_with_get_returning_405(self):
        status, note = _classify_verification(
            http_status=405,
            content_type="text/plain",
            body_sample="Method Not Allowed",
            url="https://example.com/api/v1/settings",
            method="PUT",
        )
        assert status == "VERIFIED"
        assert "PUT" in (note or "")


# ---------------------------------------------------------------------------
# 6. Shared Domains vs. Separately Hosted Backends in JS Analysis
# ---------------------------------------------------------------------------
class TestSharedAndSeparatelyHostedBackends:
    def test_extract_relative_paths_shared_domain(self):
        js_code = """
        function loadUsers() {
            return fetch('/api/v1/users').then(r => r.json());
        }
        function saveOrder(order) {
            return axios.post('/api/v1/orders', order);
        }
        """
        endpoints = _extract_from_js(js_code)
        methods_paths = [(ep.method, ep.path) for ep in endpoints]
        assert ("GET", "/api/v1/users") in methods_paths
        assert ("POST", "/api/v1/orders") in methods_paths

    def test_extract_absolute_urls_separately_hosted_backend(self):
        js_code = """
        const API_HOST = "https://api.backend-service.io";
        function fetchProducts() {
            return fetch("https://api.backend-service.io/api/v2/products");
        }
        function submitPayment(data) {
            return axios.post("https://payment.external-gateway.com/v1/charge", data);
        }
        """
        endpoints = _extract_from_js(js_code)
        methods_paths = [(ep.method, ep.path) for ep in endpoints]
        assert ("GET", "https://api.backend-service.io/api/v2/products") in methods_paths
        assert ("POST", "https://payment.external-gateway.com/v1/charge") in methods_paths

    def test_skip_path_with_absolute_url_assets(self):
        assert _should_skip_path("https://cdn.example.com/static/bundle.js") is True
        assert _should_skip_path("https://cdn.example.com/assets/logo.png") is True
        assert _should_skip_path("https://api.example.com/v1/users") is False


# ---------------------------------------------------------------------------
# 7. Async verify_endpoint Probing with Mock Transport
# ---------------------------------------------------------------------------
class TestVerifyEndpointAsync:
    @pytest.mark.asyncio
    async def test_verify_endpoint_json_api(self, monkeypatch):
        monkeypatch.setattr("app.discovery.verifier.validate_url_for_outbound", lambda url, context="": None)

        def handler(request: httpx.Request):
            return httpx.Response(
                200,
                headers={"Content-Type": "application/json"},
                json={"status": "healthy"},
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        result = await verify_endpoint(
            url="https://api.example.com/v1/health",
            method="GET",
            client=client,
        )
        assert result.status == "VERIFIED"
        assert result.http_status == 200
        assert result.content_type == "application/json"

    @pytest.mark.asyncio
    async def test_verify_endpoint_spa_fallback(self, monkeypatch):
        monkeypatch.setattr("app.discovery.verifier.validate_url_for_outbound", lambda url, context="": None)

        def handler(request: httpx.Request):
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text="<!doctype html><html><body><div id='root'></div><script src='/main.js'></script></body></html>",
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        result = await verify_endpoint(
            url="https://example.com/api/v1/nonexistent",
            method="GET",
            client=client,
        )
        assert result.status == "WEB_PAGE"
        assert "SPA fallback" in (result.diagnostic_notes or "")

    @pytest.mark.asyncio
    async def test_verify_endpoint_405_non_destructive_post(self, monkeypatch):
        monkeypatch.setattr("app.discovery.verifier.validate_url_for_outbound", lambda url, context="": None)

        def handler(request: httpx.Request):
            assert request.method == "GET"  # Non-destructive probe
            return httpx.Response(
                405,
                headers={"Allow": "POST", "Content-Type": "application/json"},
                json={"detail": "Method Not Allowed"},
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        result = await verify_endpoint(
            url="https://example.com/api/v1/checkout",
            method="POST",
            client=client,
        )
        assert result.status == "VERIFIED"
        assert result.http_status == 405
        assert "405" in (result.diagnostic_notes or "")


# ---------------------------------------------------------------------------
# 8. Health Checker Verification Tests (Monitoring Pipeline)
# ---------------------------------------------------------------------------
class TestMonitoringHealthChecker:
    @pytest.mark.asyncio
    async def test_checker_detects_spa_fallback_on_api(self, monkeypatch):
        """
        When monitored API endpoint returns 200 OK with SPA shell index.html,
        health check must fail with UNEXPECTED_HTML_FALLBACK!
        """
        monkeypatch.setattr("app.monitoring.checker.validate_url_for_outbound", lambda url, context="": None)
        endpoint = Endpoint(
            name="Get Users",
            url="https://example.com/api/v1/users",
            method="GET",
            expected_status=200,
            timeout_ms=5000,
            latency_threshold_ms=2000,
        )

        spa_html = "<!doctype html><html><body><div id='root'></div></body></html>"

        async def mock_request(self, *args, **kwargs):
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text=spa_html,
            )

        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        result = await run_check(endpoint)
        assert result.success is False
        assert result.failure_reason == "UNEXPECTED_HTML_FALLBACK"

    @pytest.mark.asyncio
    async def test_checker_detects_masked_html_error_page(self, monkeypatch):
        monkeypatch.setattr("app.monitoring.checker.validate_url_for_outbound", lambda url, context="": None)
        endpoint = Endpoint(
            name="Get Orders",
            url="https://example.com/api/v1/orders",
            method="GET",
            expected_status=200,
            timeout_ms=5000,
            latency_threshold_ms=2000,
        )

        error_html = "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>"

        async def mock_request(self, *args, **kwargs):
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text=error_html,
            )

        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        result = await run_check(endpoint)
        assert result.success is False
        assert result.failure_reason == "HTML_ERROR_PAGE"

    @pytest.mark.asyncio
    async def test_checker_allows_legitimate_html_endpoint(self, monkeypatch):
        """Endpoints tagged or configured for HTML are allowed to return HTML."""
        monkeypatch.setattr("app.monitoring.checker.validate_url_for_outbound", lambda url, context="": None)
        endpoint = Endpoint(
            name="Invoice HTML Preview",
            url="https://example.com/api/v1/invoice/preview.html",
            method="GET",
            expected_status=200,
            timeout_ms=5000,
            latency_threshold_ms=2000,
            tags="html,preview",
        )

        invoice_html = "<html><body><h1>Invoice #1001</h1><p>Amount: $50</p></body></html>"

        async def mock_request(self, *args, **kwargs):
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text=invoice_html,
            )

        monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

        result = await run_check(endpoint)
        assert result.success is True
        assert result.status_code == 200
