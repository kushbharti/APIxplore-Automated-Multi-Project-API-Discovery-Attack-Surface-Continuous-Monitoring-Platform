"""
app/services/endpoint_schema.py
===============================
Extracts parameter schemas (path, query, header) and request body schemas
for an endpoint from OpenAPI specs (if available) or URL structure.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ssrf import validate_url_for_outbound
from app.models.discovery_run import DiscoveryRun
from app.models.endpoint import Endpoint
from app.schemas.endpoint import BodyField, EndpointSchemaOut, ParameterField, RequestBodySchema

logger = structlog.get_logger(__name__)

# In-memory cache for openapi specs: url -> spec dict
_SPEC_CACHE: dict[str, dict[str, Any]] = {}


def _extract_path_params_from_str(s: str) -> list[str]:
    params: list[str] = []
    # matches {id}
    for m in re.finditer(r"\{([a-zA-Z0-9_-]+)\}", s):
        p = m.group(1)
        if p not in params:
            params.append(p)
    # matches :id (e.g. /users/:id)
    for m in re.finditer(r"(?<=/):([a-zA-Z0-9_-]+)", s):
        p = m.group(1)
        if p not in params:
            params.append(p)
    return params


def _normalize_path_for_matching(p: str) -> str:
    """Normalize /users/{id} and /users/:id to /users/{param}"""
    clean = re.sub(r"\{[a-zA-Z0-9_-]+\}", "{_}", p.rstrip("/"))
    clean = re.sub(r":([a-zA-Z0-9_-]+)", "{_}", clean)
    return clean.lower()


def _resolve_ref(spec: dict[str, Any], ref: str) -> dict[str, Any]:
    """Resolve a local $ref like #/components/schemas/User or #/definitions/User."""
    if not ref.startswith("#/"):
        return {}
    parts = ref.lstrip("#/").split("/")
    curr: Any = spec
    for part in parts:
        if isinstance(curr, dict) and part in curr:
            curr = curr[part]
        else:
            return {}
    return curr if isinstance(curr, dict) else {}


async def fetch_spec(spec_url: str) -> dict[str, Any] | None:
    if spec_url in _SPEC_CACHE:
        return _SPEC_CACHE[spec_url]
    try:
        validate_url_for_outbound(spec_url, context="openapi_schema_fetch")
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(spec_url)
            if resp.status_code in (200, 201):
                try:
                    data = resp.json()
                    if isinstance(data, dict):
                        _SPEC_CACHE[spec_url] = data
                        return data
                except Exception:
                    pass
    except Exception as exc:
        logger.debug("fetch_spec_failed", spec_url=spec_url, error=str(exc))
    return None


def _extract_body_field(
    prop_name: str,
    prop_def: dict[str, Any],
    required: bool,
    spec: dict[str, Any],
    depth: int = 0,
) -> BodyField:
    if depth > 5:
        return BodyField(name=prop_name, type="string", required=required)

    if isinstance(prop_def, dict) and "$ref" in prop_def:
        prop_def = _resolve_ref(spec, prop_def["$ref"])

    if not isinstance(prop_def, dict):
        return BodyField(name=prop_name, type="string", required=required)

    p_type = str(prop_def.get("type", "object" if "properties" in prop_def else "string"))
    p_desc = prop_def.get("description")
    p_def = prop_def.get("default")
    p_enum = prop_def.get("enum")

    nested_fields: list[BodyField] = []
    item_type: str | None = None
    item_fields: list[BodyField] = []

    # Nested object properties
    if p_type == "object" or "properties" in prop_def:
        props = prop_def.get("properties", {})
        req_list = prop_def.get("required", []) if isinstance(prop_def.get("required"), list) else []
        if isinstance(props, dict):
            for child_name, child_def in props.items():
                child_req = child_name in req_list
                nested_fields.append(_extract_body_field(child_name, child_def, child_req, spec, depth + 1))

    # Array items
    elif p_type == "array" or "items" in prop_def:
        items_def = prop_def.get("items", {})
        if isinstance(items_def, dict) and "$ref" in items_def:
            items_def = _resolve_ref(spec, items_def["$ref"])
        if isinstance(items_def, dict):
            item_type = str(items_def.get("type", "object" if "properties" in items_def else "string"))
            if item_type == "object" or "properties" in items_def:
                sub_props = items_def.get("properties", {})
                sub_req = items_def.get("required", []) if isinstance(items_def.get("required"), list) else []
                if isinstance(sub_props, dict):
                    for child_name, child_def in sub_props.items():
                        child_req = child_name in sub_req
                        item_fields.append(_extract_body_field(child_name, child_def, child_req, spec, depth + 1))

    return BodyField(
        name=prop_name,
        type=p_type,
        required=required,
        description=p_desc,
        default=p_def,
        enum=p_enum,
        fields=nested_fields,
        item_type=item_type,
        item_fields=item_fields,
    )


async def get_endpoint_schema(endpoint: Endpoint, session: AsyncSession) -> EndpointSchemaOut:
    raw_path = endpoint.path or urlparse(endpoint.url).path or "/"
    path_param_names = _extract_path_params_from_str(endpoint.url) + _extract_path_params_from_str(raw_path)

    seen_params: set[str] = set()
    unique_path_params: list[str] = []
    for p in path_param_names:
        if p not in seen_params:
            seen_params.add(p)
            unique_path_params.append(p)

    path_parameters: list[ParameterField] = [
        ParameterField(name=p, in_="path", required=True, type="string")
        for p in unique_path_params
    ]
    query_parameters: list[ParameterField] = []
    headers: list[ParameterField] = []
    request_body: RequestBodySchema | None = None

    # Parse query params from URL if present
    parsed_url = urlparse(endpoint.url)
    if parsed_url.query:
        qs = parse_qs(parsed_url.query)
        for k, vals in qs.items():
            query_parameters.append(
                ParameterField(name=k, in_="query", required=False, type="string", default=vals[0] if vals else None)
            )

    # Check if project has an OpenAPI spec
    spec: dict[str, Any] | None = None
    if endpoint.project_id:
        stmt = (
            select(DiscoveryRun)
            .where(
                DiscoveryRun.project_id == str(endpoint.project_id),
                DiscoveryRun.openapi_found.is_(True),
                DiscoveryRun.openapi_url.is_not(None),
            )
            .order_by(DiscoveryRun.created_at.desc())
            .limit(1)
        )
        res = await session.execute(stmt)
        run = res.scalar_one_or_none()
        if run and run.openapi_url:
            spec = await fetch_spec(run.openapi_url)

    if spec and isinstance(spec.get("paths"), dict):
        norm_target_path = _normalize_path_for_matching(raw_path)
        matched_op: dict[str, Any] | None = None
        matched_path_item: dict[str, Any] | None = None

        for spec_path, path_item in spec["paths"].items():
            if not isinstance(path_item, dict):
                continue
            if _normalize_path_for_matching(spec_path) == norm_target_path:
                matched_path_item = path_item
                op = path_item.get(endpoint.method.lower())
                if isinstance(op, dict):
                    matched_op = op
                    break

        if matched_op:
            all_params: list[dict[str, Any]] = []
            if matched_path_item and isinstance(matched_path_item.get("parameters"), list):
                all_params.extend(matched_path_item["parameters"])
            if isinstance(matched_op.get("parameters"), list):
                all_params.extend(matched_op["parameters"])

            spec_path_params: list[ParameterField] = []
            spec_query_params: list[ParameterField] = []
            spec_headers: list[ParameterField] = []

            for param in all_params:
                if isinstance(param, dict) and "$ref" in param:
                    param = _resolve_ref(spec, param["$ref"])
                if not isinstance(param, dict):
                    continue

                p_in = param.get("in", "")
                p_name = param.get("name", "")
                p_req = bool(param.get("required", False))
                p_desc = param.get("description")
                p_schema = param.get("schema", {})
                if isinstance(p_schema, dict) and "$ref" in p_schema:
                    p_schema = _resolve_ref(spec, p_schema["$ref"])

                p_type = p_schema.get("type", param.get("type", "string")) if isinstance(p_schema, dict) else "string"
                p_def = p_schema.get("default", param.get("default")) if isinstance(p_schema, dict) else None
                p_enum = p_schema.get("enum", param.get("enum")) if isinstance(p_schema, dict) else None

                pf = ParameterField(
                    name=p_name,
                    in_=p_in,
                    required=p_req,
                    type=str(p_type),
                    description=p_desc,
                    default=p_def,
                    enum=p_enum,
                )
                if p_in == "path":
                    spec_path_params.append(pf)
                elif p_in == "query":
                    spec_query_params.append(pf)
                elif p_in == "header":
                    spec_headers.append(pf)

            if spec_path_params:
                path_parameters = spec_path_params
            if spec_query_params:
                query_parameters = spec_query_params
            if spec_headers:
                headers = spec_headers

            # Request Body (OpenAPI 3.x)
            rb = matched_op.get("requestBody")
            if isinstance(rb, dict):
                if "$ref" in rb:
                    rb = _resolve_ref(spec, rb["$ref"])
                rb_req = bool(rb.get("required", False))
                content = rb.get("content", {})
                if isinstance(content, dict) and content:
                    all_content_types = list(content.keys())
                    ct = "application/json" if "application/json" in all_content_types else all_content_types[0]
                    ct_obj = content[ct]
                    schema = ct_obj.get("schema", {}) if isinstance(ct_obj, dict) else {}
                    if isinstance(schema, dict) and "$ref" in schema:
                        schema = _resolve_ref(spec, schema["$ref"])

                    fields: list[BodyField] = []
                    props = schema.get("properties", {}) if isinstance(schema, dict) else {}
                    required_fields = schema.get("required", []) if isinstance(schema, dict) else []
                    if isinstance(props, dict):
                        for prop_name, prop_def in props.items():
                            fields.append(
                                _extract_body_field(
                                    prop_name=prop_name,
                                    prop_def=prop_def,
                                    required=prop_name in required_fields,
                                    spec=spec,
                                )
                            )
                    request_body = RequestBodySchema(
                        content_type=ct,
                        content_types=all_content_types,
                        required=rb_req,
                        fields=fields,
                        raw_schema=schema if isinstance(schema, dict) else None,
                    )

            # Swagger 2.0 body parameter
            if request_body is None:
                for param in all_params:
                    if isinstance(param, dict) and param.get("in") == "body":
                        schema = param.get("schema", {})
                        if isinstance(schema, dict) and "$ref" in schema:
                            schema = _resolve_ref(spec, schema["$ref"])
                        fields = []
                        props = schema.get("properties", {}) if isinstance(schema, dict) else {}
                        required_fields = schema.get("required", []) if isinstance(schema, dict) else []
                        if isinstance(props, dict):
                            for prop_name, prop_def in props.items():
                                fields.append(
                                    _extract_body_field(
                                        prop_name=prop_name,
                                        prop_def=prop_def,
                                        required=prop_name in required_fields,
                                        spec=spec,
                                    )
                                )
                        request_body = RequestBodySchema(
                            content_type="application/json",
                            content_types=["application/json"],
                            required=bool(param.get("required", False)),
                            fields=fields,
                            raw_schema=schema if isinstance(schema, dict) else None,
                        )
                        break

    # If method is POST, PUT, or PATCH and no schema body was defined:
    # Allow user to provide a JSON body without inventing fake fields
    if request_body is None and endpoint.method.upper() in ("POST", "PUT", "PATCH"):
        request_body = RequestBodySchema(
            content_type="application/json",
            content_types=["application/json", "application/x-www-form-urlencoded", "text/plain"],
            required=False,
            fields=[],
            raw_schema=None,
        )

    return EndpointSchemaOut(
        endpoint_id=endpoint.id,
        method=endpoint.method,
        url=endpoint.url,
        path=raw_path,
        path_parameters=path_parameters,
        query_parameters=query_parameters,
        headers=headers,
        request_body=request_body,
    )
