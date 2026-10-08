"""
Checks a user-written test case against the sample input.

A custom case is only useful if it really differs from the sample, so we
diff the two and describe exactly what changed. If the only kind of change is
one the generator already knows about (removed fields, null values, type
changes) it gets that category; anything else is "custom".
"""
import re

from analysis.edge_cases import _infer_type, generate_edge_cases

LABEL_PATTERN = re.compile(r"^[a-z0-9_]{1,40}$")


def _type_name(value):
    return "null" if value is None else _infer_type(value)


def _short(value, limit=40):
    text = repr(value)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _diff(sample, payload):
    """Lists every top-level difference between sample and payload."""
    changes = []
    for field, original in sample.items():
        if field not in payload:
            changes.append({"field": field, "kind": "removed"})
            continue
        new = payload[field]
        if new is None and original is not None:
            changes.append({"field": field, "kind": "set_null"})
        elif original is not None and _type_name(new) != _type_name(original):
            changes.append({"field": field, "kind": "type_change",
                            "from": _type_name(original), "to": _type_name(new)})
        elif new != original:
            changes.append({"field": field, "kind": "value_change",
                            "from": original, "to": new})
    for field in payload:
        if field not in sample:
            changes.append({"field": field, "kind": "added", "to": payload[field]})
    return changes


def _describe(change):
    field = change["field"]
    kind = change["kind"]
    if kind == "removed":
        return f"'{field}' removed"
    if kind == "set_null":
        return f"'{field}' set to null"
    if kind == "type_change":
        return f"'{field}' changed type from {change['from']} to {change['to']}"
    if kind == "value_change":
        return f"'{field}' changed from {_short(change['from'])} to {_short(change['to'])}"
    return f"unknown field '{field}' added ({_short(change['to'])})"


# If every change is of one of these kinds, the case gets that category.
_SINGLE_KIND_CATEGORY = {
    "removed": "missing_field",
    "set_null": "null_value",
    "type_change": "type_mismatch",
}


def _reject(reason):
    return {"valid": False, "reason": reason, "category": None, "description": None, "changes": []}


def classify_custom_case(sample_input, payload, label=None):
    """
    Validates a custom edge case and describes how it differs from the sample.

    Returns {valid, reason, category, description, changes}. When label is
    given it must match ^[a-z0-9_]{1,40}$ and must not equal a label the
    generator would produce for this sample.
    """
    if not isinstance(sample_input, dict):
        return _reject("Sample input must be a JSON object")
    if not isinstance(payload, dict):
        return _reject("Payload must be a JSON object")

    if label is not None:
        if not isinstance(label, str) or not LABEL_PATTERN.match(label):
            return _reject("Label must be 1-40 characters: lowercase letters, digits or _")
        generated = {case["label"] for case in generate_edge_cases(sample_input)}
        if label in generated:
            return _reject(f"Label '{label}' is already used by a generated case")

    # Identical means "no differences found", not payload == sample: Python
    # treats 1 == True and 30 == 30.0 as equal, but those are type changes.
    changes = _diff(sample_input, payload)
    if not changes:
        return _reject("Not an edge case — identical to the sample")

    kinds = {c["kind"] for c in changes}
    category = _SINGLE_KIND_CATEGORY.get(next(iter(kinds))) if len(kinds) == 1 else None

    return {
        "valid": True,
        "reason": None,
        "category": category or "custom",
        "description": "; ".join(_describe(c) for c in changes),
        "changes": changes,
    }
