# Traceability rules

These rules are implemented in `src/shared/trace.ts` and covered by `tests/trace.test.ts`. If you change a rule, change the test and this page together.

## Definitions

| Term | Rule |
|---|---|
| Active requirement | Any requirement whose status isn't `deferred` |
| Leaf requirement | An active requirement with no active children |
| Allocated | A requirement linked to at least one component, or one whose active children are **all** allocated |
| Verification state | The worst state among the requirement's own tests and its active children's states |

### Verification states, from worst to best

| State | Meaning |
|---|---|
| `failing` | At least one linked test has failed |
| `blocked` | At least one linked test is blocked, and none has failed |
| `unverified` | No tests are linked, and no children provide verification |
| `planned` | Tests are linked, but at least one hasn't been run yet |
| `passed` | Every linked test, and every child requirement, has passed |

A parent requirement with one unverified child is itself `unverified`, even if its other children pass. That's deliberate: a parent is only proven when everything it decomposes into is proven.

## Coverage metrics

All percentages are **leaf requirements only**. If both a parent and its children were counted, a parent would add a "free" point of coverage whenever its children were covered.

- **Allocation coverage** = allocated leaves / all leaves
- **Verification planned** = leaves with at least one linked test / all leaves
- **Verified and passing** = leaves in state `passed` / all leaves

Deferred requirements are excluded from every metric. An empty model reports 0%, not an error.

## Gaps

| Gap | Raised when |
|---|---|
| `orphan-requirement` | A requirement has no parent, no children, no components and no tests. It's reported once, instead of also counting as unallocated and unverified |
| `unallocated` | A leaf isn't allocated |
| `unverified` | A leaf has no linked test |
| `failing` | A requirement has a failed test |
| `method-mismatch` | Tests are linked, but none uses the requirement's planned verification method |
| `status-inconsistent` | The status is `verified`, but the verification state isn't `passed` |
| `orphan-component` | A component satisfies no requirement and has no child component that does |
| `orphan-test` | A test verifies no requirement |
| `suspect-link` | The requirement's title or description changed after the link was last reviewed |

Gaps are sorted with high-priority requirements first.

## Suspect links

Changing a requirement's **title or description** sets `suspect = true` on all of its links, because whatever was verified or allocated was checked against the old wording. Changing only its status, priority or other metadata doesn't. A reviewer clears a suspect flag with **Mark reviewed**, and that review is written to the audit log.

## Impact analysis

For requirement *R*, the impact set is:

1. **Ancestors**: every parent up to the top level.
2. **Descendants**: every child, grandchild and so on.
3. **Components**: those linked to *R* or to any descendant.
4. **Tests**: those linked to *R* or to any descendant. These are the tests to re-run.
5. **Related requirements**: other requirements (outside *R* and its descendants) allocated to any of those components. A design change made for *R* could affect them too.

## Hierarchy integrity

A requirement can't become its own parent, or a descendant of itself. These changes are rejected with a 400 error when you edit a requirement, and the whole import is rejected if its hierarchy contains a loop. A requirement that has children can't be deleted until they're re-parented or deleted first.
