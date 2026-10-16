Feature: Schema fragments validate against their named schema
  Regression coverage for the $defs sub-schemas (push_updates and friends).
  Each fragment's schema is chosen from its filename prefix, e.g.
  push_updates.push_value.yaml is checked against the push_updates schema.
  Drop a new fragment into fragments/valid or fragments/invalid to extend
  coverage; no table edits required.

  Rule: valid fragments pass validation

    Scenario: every fragment under fragments/valid validates cleanly
      Given the fragments in "valid"
      Then they all validate

  Rule: invalid fragments are rejected

    Scenario: every fragment under fragments/invalid is rejected
      Given the fragments in "invalid"
      Then they all fail validation
