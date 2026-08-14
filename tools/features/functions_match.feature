Feature: Api functions match expected output
  Making sure api functions produce the expected output

  Scenario Outline: Test cases living in cases/<dir> match expected output
    Given the test case <dir>
    When passed to <function>
    Then the function succeeds with no diagnostics
    And the output "data" is there

    Examples:
      | function | dir |
      | resolve | device |
      | resolve | template_chain |
      | resolve | template_internal |
      | resolve | template_oid |

  Scenario: Resolving import_merge inlines the import and records it with its declared provenance
    Given the test case import_merge
    When passed to resolve
    Then the function succeeds with no diagnostics
    And the output "data" is there
    And the resolved imports match