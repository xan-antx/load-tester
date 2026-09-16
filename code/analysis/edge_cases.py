import copy

SQLI_PAYLOADS = ["' OR '1'='1", "'; DROP TABLE users; --", "1 OR 1=1"]
XSS_PAYLOADS = ["<script>alert(1)</script>", "\"><img src=x onerror=alert(1)>"]


def _infer_type(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return "unknown"


def generate_edge_cases(sample_input: dict) -> list:
    """
    Given a sample request body, returns a list of edge case dicts,
    each with a unique label, category, description, and payload.
    Nested objects/arrays only get missing-field and null-value cases
    (type mismatch / boundary / attack payloads only make sense for
    scalar fields).
    """
    cases = []

    for field, value in sample_input.items():
        field_type = _infer_type(value)

        # 1. Missing field (always applies)
        missing = copy.deepcopy(sample_input)
        del missing[field]
        cases.append({
            "label": f"missing_{field}",
            "category": "missing_field",
            "description": f"Request with '{field}' removed entirely",
            "payload": missing,
        })

        # 2. Null value (always applies)
        null_case = copy.deepcopy(sample_input)
        null_case[field] = None
        cases.append({
            "label": f"null_{field}",
            "category": "null_value",
            "description": f"'{field}' set to null",
            "payload": null_case,
        })

        # Everything below only applies to scalar fields
        if field_type not in ("int", "float", "str", "bool"):
            continue

        # 3. Type mismatch
        wrong_type_value = {
            "int": "not_a_number",
            "float": "not_a_number",
            "str": 12345,
            "bool": "not_a_bool",
        }.get(field_type)
        if wrong_type_value is not None:
            type_case = copy.deepcopy(sample_input)
            type_case[field] = wrong_type_value
            cases.append({
                "label": f"wrong_type_{field}",
                "category": "type_mismatch",
                "description": f"'{field}' given a {type(wrong_type_value).__name__} instead of {field_type}",
                "payload": type_case,
            })

        # 4. Boundary values
        if field_type in ("int", "float"):
            for label, val in [("very_large", 10**12), ("negative", -1), ("zero", 0)]:
                b_case = copy.deepcopy(sample_input)
                b_case[field] = val
                cases.append({
                    "label": f"{label}_{field}",
                    "category": "boundary_value",
                    "description": f"'{field}' set to {label.replace('_', ' ')} ({val})",
                    "payload": b_case,
                })
        if field_type == "str":
            for label, val in [("empty_string", ""), ("very_long_string", "A" * 5000)]:
                b_case = copy.deepcopy(sample_input)
                b_case[field] = val
                cases.append({
                    "label": f"{label}_{field}",
                    "category": "boundary_value",
                    "description": f"'{field}' set to {label.replace('_', ' ')}",
                    "payload": b_case,
                })

        # 5. Known attack payloads (string fields only)
        if field_type == "str":
            for i, payload in enumerate(SQLI_PAYLOADS):
                a_case = copy.deepcopy(sample_input)
                a_case[field] = payload
                cases.append({
                    "label": f"sqli_{field}_{i}",
                    "category": "known_attack",
                    "description": f"SQL injection attempt in '{field}'",
                    "payload": a_case,
                })
            for i, payload in enumerate(XSS_PAYLOADS):
                a_case = copy.deepcopy(sample_input)
                a_case[field] = payload
                cases.append({
                    "label": f"xss_{field}_{i}",
                    "category": "known_attack",
                    "description": f"XSS attempt in '{field}'",
                    "payload": a_case,
                })

    return cases