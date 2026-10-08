from app import app

SAMPLE = {"username": "demo", "password": "demo123", "expiresInMins": 30}


def _post(path, body):
    return app.test_client().post(path, json=body)


def test_validate_endpoint_accepts_a_real_edge_case():
    resp = _post("/api/validate-custom-case",
                 {"sample_input": SAMPLE, "label": "admin_user", "payload": {**SAMPLE, "username": "admin"}})
    assert resp.status_code == 200
    assert resp.get_json()["valid"] is True


def test_validate_endpoint_rejects_identical_payload():
    body = _post("/api/validate-custom-case",
                 {"sample_input": SAMPLE, "label": "same", "payload": dict(SAMPLE)}).get_json()
    assert body["valid"] is False


def test_validate_endpoint_requires_a_label():
    body = _post("/api/validate-custom-case",
                 {"sample_input": SAMPLE, "payload": {**SAMPLE, "username": "x"}}).get_json()
    assert body["valid"] is False


def test_confirm_without_custom_cases_is_unchanged():
    resp = _post("/api/confirm-selection", {"sample_input": SAMPLE, "selected_labels": ["null_password"]})
    assert resp.status_code == 200
    assert [c["label"] for c in resp.get_json()["confirmed_cases"]] == ["null_password"]

    resp = _post("/api/confirm-selection", {"sample_input": SAMPLE, "selected_labels": []})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "selected_labels (list) is required"


def test_confirm_appends_valid_custom_cases():
    custom = {"label": "admin_user", "payload": {**SAMPLE, "username": "admin"}}
    resp = _post("/api/confirm-selection",
                 {"sample_input": SAMPLE, "selected_labels": ["null_password"], "custom_cases": [custom]})
    assert resp.status_code == 200
    cases = resp.get_json()["confirmed_cases"]
    assert [c["label"] for c in cases] == ["null_password", "admin_user"]
    assert cases[1]["category"] == "custom"
    assert cases[1]["payload"]["username"] == "admin"


def test_confirm_allows_only_custom_cases():
    custom = {"label": "admin_user", "payload": {**SAMPLE, "username": "admin"}}
    resp = _post("/api/confirm-selection", {"sample_input": SAMPLE, "custom_cases": [custom]})
    assert resp.status_code == 200
    assert resp.get_json()["confirmed_count"] == 1


def test_confirm_revalidates_custom_cases():
    bad = {"label": "same", "payload": dict(SAMPLE)}
    resp = _post("/api/confirm-selection",
                 {"sample_input": SAMPLE, "selected_labels": ["null_password"], "custom_cases": [bad]})
    assert resp.status_code == 400
    assert "identical" in resp.get_json()["error"]


def test_confirm_rejects_duplicate_custom_labels():
    custom = {"label": "admin_user", "payload": {**SAMPLE, "username": "admin"}}
    resp = _post("/api/confirm-selection",
                 {"sample_input": SAMPLE, "custom_cases": [custom, custom]})
    assert resp.status_code == 400
