"""Google Colab-friendly smoke test for the Worker URL shortener APIs.

Usage in Colab:
  !pip -q install requests
  !python colab_api_smoke_test.py --base-url "https://<your-worker-domain>"

Usage locally:
  python colab_api_smoke_test.py --base-url "http://127.0.0.1:8787"
"""

from __future__ import annotations

import argparse
import json
import random
import string
import sys
from dataclasses import dataclass
from typing import Any

import requests


@dataclass
class CheckResult:
    name: str
    passed: bool
    details: str


def random_code(length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "c" + "".join(random.choice(alphabet) for _ in range(length - 1))


def parse_json(response: requests.Response) -> dict[str, Any]:
    try:
        return response.json()
    except json.JSONDecodeError:
        return {}


def run_checks(base_url: str, timeout_s: int) -> list[CheckResult]:
    session = requests.Session()
    session.headers.update({"content-type": "application/json"})

    code = random_code()
    checks: list[CheckResult] = []

    # 1) CREATE
    create_url = f"{base_url}/api/v1/links"
    create_payload = {"url": "https://example.com", "code": code}
    create_res = session.post(create_url, json=create_payload, timeout=timeout_s)
    create_body = parse_json(create_res)

    created_ok = create_res.status_code == 201 and create_body.get("ok") is True
    checks.append(
        CheckResult(
            name="POST /api/v1/links",
            passed=created_ok,
            details=f"status={create_res.status_code}, body_ok={create_body.get('ok')}",
        )
    )

    # 2) READ
    read_url = f"{base_url}/api/v1/links/{code}"
    read_res = session.get(read_url, timeout=timeout_s)
    read_body = parse_json(read_res)

    read_ok = (
        read_res.status_code == 200
        and read_body.get("ok") is True
        and read_body.get("data", {}).get("code") == code
    )
    checks.append(
        CheckResult(
            name=f"GET /api/v1/links/{code}",
            passed=read_ok,
            details=f"status={read_res.status_code}, code={read_body.get('data', {}).get('code')}",
        )
    )

    # 3) UPDATE
    updated_url = "https://example.org/updated"
    patch_payload = {"url": updated_url, "active": True}
    patch_res = session.patch(read_url, json=patch_payload, timeout=timeout_s)
    patch_body = parse_json(patch_res)

    patch_ok = (
        patch_res.status_code == 200
        and patch_body.get("ok") is True
        and patch_body.get("data", {}).get("targetUrl") == updated_url
        and patch_body.get("data", {}).get("active") is True
    )
    checks.append(
        CheckResult(
            name=f"PATCH /api/v1/links/{code}",
            passed=patch_ok,
            details=(
                f"status={patch_res.status_code}, targetUrl="
                f"{patch_body.get('data', {}).get('targetUrl')}"
            ),
        )
    )

    # 4) REDIRECT
    redirect_res = session.get(f"{base_url}/{code}", allow_redirects=False, timeout=timeout_s)
    redirect_ok = redirect_res.status_code == 302 and redirect_res.headers.get("location") == updated_url
    checks.append(
        CheckResult(
            name=f"GET /{code} (redirect)",
            passed=redirect_ok,
            details=f"status={redirect_res.status_code}, location={redirect_res.headers.get('location')}",
        )
    )

    # 5) DELETE (soft disable)
    delete_res = session.delete(read_url, timeout=timeout_s)
    delete_body = parse_json(delete_res)
    delete_ok = (
        delete_res.status_code == 200
        and delete_body.get("ok") is True
        and delete_body.get("data", {}).get("disabled") is True
    )
    checks.append(
        CheckResult(
            name=f"DELETE /api/v1/links/{code}",
            passed=delete_ok,
            details=f"status={delete_res.status_code}, disabled={delete_body.get('data', {}).get('disabled')}",
        )
    )

    # 6) REDIRECT AFTER DELETE SHOULD FAIL
    redirect_after_delete = session.get(f"{base_url}/{code}", allow_redirects=False, timeout=timeout_s)
    after_delete_ok = redirect_after_delete.status_code == 404
    checks.append(
        CheckResult(
            name=f"GET /{code} after delete",
            passed=after_delete_ok,
            details=f"status={redirect_after_delete.status_code}",
        )
    )

    return checks


def print_report(checks: list[CheckResult]) -> bool:
    print("\nAPI smoke test report\n" + "-" * 24)
    all_passed = True
    for check in checks:
        icon = "✅" if check.passed else "❌"
        all_passed = all_passed and check.passed
        print(f"{icon} {check.name}: {check.details}")

    summary_icon = "✅" if all_passed else "❌"
    print("-" * 24)
    print(f"{summary_icon} Overall: {'PASS' if all_passed else 'FAIL'}")
    return all_passed


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test all Worker URL shortener APIs")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8787",
        help="Worker base URL (default: http://127.0.0.1:8787)",
    )
    parser.add_argument("--timeout", type=int, default=15, help="Request timeout in seconds")
    args = parser.parse_args()

    try:
        checks = run_checks(args.base_url.rstrip("/"), args.timeout)
    except requests.RequestException as exc:
        print(f"❌ Request failed: {exc}")
        return 2

    return 0 if print_report(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
