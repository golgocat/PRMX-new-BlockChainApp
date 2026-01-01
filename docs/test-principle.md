# PRMX Test Design Rulebook

**Unified Version for v1 / v2 / v3**  
**Agent Reference (Cursor-ready)**

---

## Purpose

This rulebook defines the immutable rules for test design in PRMX.

> **In PRMX, test quality defines product quality.**

All humans and AI agents must follow this document when designing tests.

This rulebook **overrides**:
- implementation convenience
- development speed
- UI / UX priorities
- short-term business decisions

---

## 1. Absolute Principles (All Versions)

### Principle 1: Testing is an act of destruction

Tests are **not** for confirming expected behavior.  
Tests exist to **break the system**.

**Mandatory:**
- At least **50%** of test cases must be abnormal, boundary, or adversarial
- Test suites composed only of happy paths are **invalid**

---

### Principle 2: Money and finality are P0

Anything related to money or finality is top priority.

**Always treat the following as P0:**
- Insurance payouts
- Early Trigger
- Maturity settlement
- Idempotency (double execution prevention)
- Policy state transitions

P0 logic must be tested at **all three layers**:
- Unit
- Integration
- End-to-End

---

### Principle 3: Oracles are hostile by default

Oracles must be treated as **unreliable and adversarial** external systems.

**Mandatory oracle failure tests:**
- delayed data
- missing data
- duplicated submissions
- out-of-order delivery
- invalid values (NaN, negative, extreme)
- partial success (off-chain success, on-chain failure)

---

## 2. Mandatory Test Classification (All Versions)

Every test must be classified into exactly one or more of the following:

| Code | Classification |
|------|----------------|
| **A** | Economic Integrity |
| **B** | State Machine Safety |
| **C** | Temporal Consistency |
| **D** | Off-chain Interaction |
| **E** | Adversarial User Behavior |

> ⚠️ **Unclassified tests are invalid.**

---

## 3. Version Model Definition

### v1: 24h rainfall
- single fixed time window
- sensitive to time boundaries
- short-term spike driven

### v2: multi-day cumulative rainfall
- multiple snapshots aggregated over days
- vulnerable to ordering and missing data
- cumulative (integration) risk

### v3: evolution / coexistence version
- v1 / v2 / v3 coexistence
- specification extension or implementation refresh
- **highest risk: backward compatibility failure**

---

## 4. Mandatory Version Declarations

Every test case must explicitly declare:
- **target version:** v1 / v2 / v3
- **time model:** single-window / cumulative / mixed
- whether **version routing** is involved
- whether **migration or upgrade** is involved

> ⚠️ **Undeclared tests are forbidden.**

---

## 5. v1-Specific Rules (24h Rainfall)

### Primary failure modes:
- 24h boundary inclusion/exclusion
- delayed data causing missed trigger
- noise-driven false positives

### Mandatory tests:
- exact 24h boundary tests
- delayed oracle delivery where trigger should have fired
- duplicated oracle reports (idempotency)

> **v1 is most fragile at time boundaries.**

---

## 6. v2-Specific Rules (Multi-day Cumulative)

### Primary failure modes:
- missing snapshots
- out-of-order snapshots
- duplicate aggregation
- cumulative error amplification

### Mandatory rules:
- cumulative values must be defined by a **set of observations**, not arrival order
- if arrival order matters, invalid ordering must be **explicitly rejected**

### Mandatory P0 tests:
- missing intermediate day
- missing final day
- reversed snapshot order
- duplicated timestamps
- Early Trigger followed by maturity settlement (no double payout)
- duration boundaries (minimum and maximum)
- abnormal values and cumulative amplification

> **v2 is most fragile with ordering and missing data.**

---

## 7. v3-Specific Rules (Evolution and Coexistence)

Every v3 test must declare at least one tag:

| Tag | Description |
|-----|-------------|
| **A** | version coexistence |
| **B** | specification extension |
| **C** | implementation refresh |
| **D** | operational / governance features |

> ⚠️ **Untagged v3 tests are forbidden.**

---

### 7.1 Compatibility Failure is P0 (v3)

**Mandatory tests:**
- decoding old storage data
- no storage key collisions
- existing policies can complete settlement after upgrade
- old clients or UIs cannot route transactions into wrong logic

> ⚠️ **Do not write new feature tests before proving backward compatibility.**

---

### 7.2 Version Routing is P0 (v3)

**Mandatory tests:**
- explicit version always routes to correct logic
- default version behavior is fixed and documented
- unsupported versions are rejected
- legacy clients do not cause undefined behavior

---

### 7.3 Migration and Upgrade Safety (P0)

**Mandatory tests:**
- migration is idempotent (0, 1, N executions converge)
- upgrade interruption and recovery
- active policies complete after upgrade
- total assets, reserves, and policy counts are preserved

> Migration correctness is part of the **specification**, not an implementation detail.

---

### 7.4 Off-chain Consistency (P0)

**Mandatory tests:**
- recovery from partial success
- at-least-once delivery convergence
- replay safety
- oracle or node restarts do not create duplicate monitoring

---

### 7.5 Operational and Governance Controls (If Introduced)

If pause, emergency stop, or risk limits exist, they are **P0**.

**Mandatory tests:**
- behavior during pause
- settlement behavior for triggers occurring before pause
- authority boundaries
- behavior when risk limits are reached

> **Operational features must be attacked first, not last.**

---

## 8. Mandatory Test Design Template

Every test case must include:

| Field | Description |
|-------|-------------|
| **Test name** | Unique identifier for the test |
| **Target version** | v1 / v2 / v3 |
| **Classification** | A–E (from Section 2) |
| **Expected failure mode** | What the test attempts to break |
| **Attacker perspective** | How a malicious actor would exploit this |
| **Expected defense** | How the system should prevent exploitation |
| **Success criteria** | Clear pass/fail conditions |
| **Impact if broken** | funds / trust / legal |

---

## 9. Coverage Definition (Numeric Coverage Forbidden)

> ⚠️ **Do not rely on percentage code coverage.**

**Accepted coverage metrics:**
- state transition coverage
- economic scenario coverage
- oracle failure scenario count
- migration completion scenarios
- cross-version arbitrage scenarios

---

## 10. AI Agent Self-Audit Checklist

Before finalizing a test suite, the agent must verify:

- [ ] Can a malicious human profit if this fails?
- [ ] Will this survive future specification changes?
- [ ] Can I clearly explain why this test exists?

> Tests that fail this self-audit must be **removed**.

---

## 11. Failure Severity Classification

| Severity | Description | Action |
|----------|-------------|--------|
| **P0** | fund loss, double payout, compatibility failure | immediate halt |
| **P1** | unfairness, broken insurance experience | fix before redeploy |
| **P2** | UI, logs, non-critical observability | backlog |

---

**End of Rulebook**

