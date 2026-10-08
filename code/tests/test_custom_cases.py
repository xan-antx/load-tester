import pytest

from analysis.custom_cases import classify_custom_case

SAMPLE = {"username": "demo", "password": "demo123", "expiresInMins": 30}


def with_(**changes):
    payload = dict(SAMPLE)
    for key, value in changes.items():
        if value == "DELETE":
            payload.pop(key)
        else:
            payload[key] = value
    return payload


def test_value_change_is_a_valid_custom_case():
    result = classify_custom_case(SAMPLE, with_(username="admin"), "admin_user")
    assert result["valid"] is True
    assert result["category"] == "custom"
    assert result["description"] == "'username' changed from 'demo' to 'admin'"
    assert result["changes"] == [{"field": "username", "kind": "value_change", "from": "demo", "to": "admin"}]


def test_identical_payload_is_rejected():
    result = classify_custom_case(SAMPLE, dict(SAMPLE), "same")
    assert result["valid"] is False
    assert result["reason"] == "Not an edge case — identical to the sample"


@pytest.mark.parametrize("payload", [[1, 2], "text", 5, None])
def test_payload_must_be_an_object(payload):
    result = classify_custom_case(SAMPLE, payload, "x")
    assert result["valid"] is False
    assert "JSON object" in result["reason"]


def test_only_removed_fields_is_missing_field():
    result = classify_custom_case(SAMPLE, with_(username="DELETE", password="DELETE"), "no_creds")
    assert result["category"] == "missing_field"
    assert "'username' removed" in result["description"]


def test_only_nulls_is_null_value():
    result = classify_custom_case(SAMPLE, with_(password=None), "pw_null")
    assert result["category"] == "null_value"


def test_only_type_changes_is_type_mismatch():
    result = classify_custom_case(SAMPLE, with_(expiresInMins="30"), "expires_text")
    assert result["category"] == "type_mismatch"
    assert result["changes"][0] == {"field": "expiresInMins", "kind": "type_change", "from": "int", "to": "str"}


def test_bool_is_a_different_type_from_int():
    result = classify_custom_case(SAMPLE, with_(expiresInMins=True), "expires_bool")
    assert result["category"] == "type_mismatch"


def test_float_instead_of_int_is_not_identical():
    # Python says 30 == 30.0, but for an API that is a different type.
    result = classify_custom_case(SAMPLE, with_(expiresInMins=30.0), "expires_float")
    assert result["valid"] is True
    assert result["category"] == "type_mismatch"


def test_mixed_change_kinds_are_custom():
    result = classify_custom_case(SAMPLE, with_(username="DELETE", password=None), "mixed")
    assert result["category"] == "custom"
    assert len(result["changes"]) == 2


def test_added_unknown_field_is_described():
    result = classify_custom_case(SAMPLE, with_(role="admin"), "extra_field")
    assert result["valid"] is True
    assert result["category"] == "custom"
    assert result["changes"] == [{"field": "role", "kind": "added", "to": "admin"}]
    assert "unknown field 'role' added" in result["description"]


@pytest.mark.parametrize("label", ["", "Has_Caps", "with space", "dash-ed", "a" * 41, 123])
def test_bad_labels_are_rejected(label):
    result = classify_custom_case(SAMPLE, with_(username="admin"), label)
    assert result["valid"] is False
    assert "Label" in result["reason"]


def test_label_colliding_with_generated_case_is_rejected():
    result = classify_custom_case(SAMPLE, with_(username="admin"), "null_password")
    assert result["valid"] is False
    assert "already used" in result["reason"]


def test_label_is_optional():
    assert classify_custom_case(SAMPLE, with_(username="admin"))["valid"] is True


def test_sample_must_be_an_object():
    assert classify_custom_case([1], {"a": 1}, "x")["valid"] is False
