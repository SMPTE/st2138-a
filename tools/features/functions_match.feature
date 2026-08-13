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
      | resolve | import_merge |
      | resolve | template_chain |
      | resolve | template_internal |
      | resolve | template_oid |