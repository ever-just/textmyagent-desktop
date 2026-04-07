---
title: TextMyAgent Security Implementation Roadmap
date: 2026-04-07
version: 1.0
---

# TextMyAgent Security Implementation Roadmap

**Status:** Comprehensive roadmap created based on audit findings  
**Date:** 2026-04-07  
**Scope:** Prioritized remediation plan for all remaining security issues

---

## Executive Summary

This document provides a **prioritized implementation roadmap** for fixing security issues in TextMyAgent. It is based on:

1. **SECURITY_TEST_PLAN.md** — 12 test categories with 100+ test cases
2. **AUDIT_FINDINGS.md** — 57 findings across 7 categories (A–G)
3. **AUDIT_REPORT.md** — Summary of critical/high findings
4. **SECURITY_VERIFICATION_RESULTS.md** — Verification of v2.0.1 fixes
5. **Git commit history** — Context of prior fixes and changes

**Key Finding:** v2.0.1 fixed 11 findings (C1, H1–H4, M2, M4, M6, L1, L6, L7), but **9 critical/high findings remain unfixed** and must be addressed before production.

---

## Part 1: Critical Issues (Must Fix Before Production)

### Priority P0: Exploit Chain (Remote Code Execution)

These three issues form an exploit chain that allows **remote code execution** on the user's machine:

#### **A2: CORS Bypass via Substring Match** (CRITICAL)
- **File:** `electron/backend/server.ts:29-33`
- **Current Code:** Uses `.includes('localhost')` and `.includes('127.0.0.1')`
- **Vulnerability:** `https://evil.localhost.attacker.com` passes the check
- **Impact:** Remote attacker-controlled website can make API requests
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:**
  ```typescript
  // WRONG (current):
  origin.includes('localhost')
  origin.includes('127.0.0.1')
  
  // CORRECT:
  const url = new URL(origin);
  const hostname = url.hostname;
  const port = url.port;
  const isAllowed = 
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    (port === String(backendPort) || port === '3000');
  ```
- **Test:** 
  ```bash
  curl -H "Origin: https://evil.localhost.attacker.com" \
       -X OPTIONS http://127.0.0.1:3001/api/health
  # Should be REJECTED
  ```

#### **A1: Command Injection in `/settings/open`** (CRITICAL)
- **File:** `electron/backend/routes/dashboard.ts:471-474`
- **Current Code:** `exec(\`open "${settingsUrl}"\`)`
- **Vulnerability:** `settingsUrl` from HTTP request body is interpolated directly into shell command
- **Impact:** Combined with A2, remote attacker can execute arbitrary shell commands
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Use `PermissionService.openSystemSettings()` which validates URL allowlist
- **Test:**
  ```bash
  curl -X POST http://127.0.0.1:3001/api/dashboard/settings/open \
       -H "Content-Type: application/json" \
       -d '{"settingsUrl": "javascript:alert(1)"}'
  # Should be REJECTED
  ```

#### **A3: SSE Endpoint Hardcodes `Access-Control-Allow-Origin: *`** (HIGH)
- **File:** `electron/backend/routes/dashboard.ts:219`
- **Current Code:** `res.setHeader('Access-Control-Allow-Origin', '*')`
- **Vulnerability:** Any website in any browser can subscribe to real-time logs
- **Impact:** Logs contain phone numbers, message previews, error details
- **Fix Effort:** Small (2 minutes)
- **Fix Approach:** Remove the wildcard header, rely on CORS middleware
- **Test:**
  ```bash
  # From attacker website
  fetch('http://127.0.0.1:3001/api/dashboard/logs/stream', {
    method: 'GET',
    credentials: 'include'
  })
  # Should be REJECTED due to CORS
  ```

---

### Priority P1: Critical Functional Bugs

#### **B1: Newlines Display as Literal `\n`** (CRITICAL)
- **File:** `electron/backend/services/iMessageService.ts:278-281`
- **Current Code:**
  ```typescript
  const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');  // WRONG: replaces with literal \n
  ```
- **Vulnerability:** AppleScript does NOT interpret `\n` inside double quotes as newline
- **Impact:** Every multi-line Claude response displays with literal `\n` characters in iMessage
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:**
  ```typescript
  const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '" & tab & "')
    .replace(/\r/g, '" & return & "')
    .replace(/\n/g, '" & linefeed & "');  // CORRECT
  ```
- **Test:** Send multi-line Claude response, verify it displays with actual line breaks in iMessage

#### **B2: `attributedBody` Truncates Messages >254 Characters** (CRITICAL)
- **File:** `electron/backend/services/iMessageService.ts:246-248`
- **Current Code:** Reads single byte for text length (max 254)
- **Vulnerability:** NSArchiver uses variable-length integer encoding; single-byte limit is wrong
- **Impact:** Any incoming iMessage >254 chars is silently dropped on newer macOS
- **Fix Effort:** Medium (30 minutes)
- **Fix Approach:** Implement proper variable-length integer parsing for BER encoding
- **Test:** Send 500-character iMessage, verify agent receives and responds to it

#### **B3: App Deadlock on Quit (SSE Connections)** (CRITICAL)
- **File:** `electron/main.ts:163-177` + `electron/backend/server.ts:124-136`
- **Current Code:** `will-quit` handler calls `server.close()` which waits for ALL connections
- **Vulnerability:** SSE log stream connections are kept alive indefinitely
- **Impact:** User must force-quit the application; normal quit hangs forever
- **Fix Effort:** Medium (30 minutes)
- **Fix Approach:**
  1. Track all SSE connections
  2. Close them explicitly before `server.close()`
  3. Add timeout to `server.close()`
- **Test:** Open app, open dashboard logs (SSE stream), quit app → should exit cleanly in <5 seconds

#### **C1: Concurrent Message Processing Race Condition** (CRITICAL)
- **File:** `electron/backend/services/AgentService.ts:99-103`
- **Current Code:** Dedup is on `message.guid`, not `chatGuid`
- **Vulnerability:** Two messages in same chat → both pass dedup check (different GUIDs)
- **Impact:** Concurrent API calls, overlapping context, out-of-order responses, DB write races
- **Fix Effort:** Medium (30 minutes)
- **Fix Approach:** Use per-chat lock (already partially implemented with `chatLocks`)
- **Test:** Send 2 messages to same chat simultaneously, verify only one API call made

#### **C2: `pollNewMessages` Concurrent with Itself** (HIGH)
- **File:** `electron/backend/services/iMessageService.ts:112-114`
- **Current Code:** `setInterval(async () => { await this.pollNewMessages(); })`
- **Vulnerability:** `setInterval` does NOT await; if poll takes >2s, next tick fires while previous running
- **Impact:** Same messages processed twice, dedup partially mitigates but ROWID update not atomic
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Use flag to prevent concurrent execution
  ```typescript
  private isPolling = false;
  
  this.pollInterval = setInterval(async () => {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.pollNewMessages();
    } finally {
      this.isPolling = false;
    }
  }, intervalMs);
  ```
- **Test:** Monitor logs, verify no "polling already in progress" messages

---

### Priority P2: High-Severity Functional Bugs

#### **B4: `getConversationHistory` Ignores `attributedBody`** (HIGH)
- **File:** `electron/backend/services/iMessageService.ts:353-366`
- **Current Code:** `WHERE c.guid = ? AND m.text IS NOT NULL`
- **Impact:** Conversation context is incomplete on newer macOS
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Include `attributedBody` in SELECT and parse it

#### **B5: Config Changes Never Take Effect on Claude** (HIGH)
- **File:** `electron/backend/routes/dashboard.ts:178-193`
- **Current Code:** `PUT /config` writes to SQLite but never calls `claudeService.setModel()`, etc.
- **Impact:** User changes model/temperature/tokens, nothing happens
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Call setter methods on `claudeService` after updating settings

#### **B6: README Claims Haiku, Code Uses Sonnet 4** (HIGH)
- **File:** README.md + `ClaudeService.ts:20`
- **Impact:** Users expect Haiku pricing (~$0.25/$1.25 per MTok) but charged Sonnet 4 (~$3/$15)
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Update README to reflect actual default model

#### **B7: `recordApiUsage` Logs Wrong Model** (HIGH)
- **File:** `electron/backend/services/ClaudeService.ts:102`
- **Current Code:** Doesn't pass model, defaults to Haiku in database.ts:270
- **Impact:** Usage dashboard shows wrong model and wrong cost projections
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Pass actual model to `recordApiUsage()`

#### **B8: `handleIncomingMessage` Doesn't Check `isRunning`** (HIGH)
- **File:** `electron/backend/services/AgentService.ts:25-28, 90`
- **Impact:** Agent sends responses after user explicitly stopped it
- **Fix Effort:** Small (2 minutes)
- **Fix Approach:** Add `if (!this.isRunning) return;` at start of `handleIncomingMessage`

#### **B9: `checkPermissions()` Leaks Database Connections** (HIGH)
- **File:** `electron/backend/services/iMessageService.ts:432-434`
- **Current Code:** No try/finally, `testDb.close()` skipped on error
- **Impact:** File descriptor exhaustion over time
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Use try/finally block

#### **B10: `ClaudeService.initClient()` Permanently Fails** (HIGH)
- **File:** `electron/backend/services/ClaudeService.ts:29-43`
- **Current Code:** Sets `initialized = true` even if client init fails
- **Impact:** Agent silently fails on every message if auto-start runs before key is set
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Only set `initialized = true` after successful client creation

---

## Part 2: Medium-Priority Issues

### Performance & Memory Leaks

#### **D1: `lastMessageRowId` Written on Every Message** (HIGH)
- **File:** `electron/backend/services/iMessageService.ts:168-169`
- **Impact:** Up to 25 writes/second of redundant I/O
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Persist once after poll loop, not per-message

#### **D2: `checkPermissions()` Opens New DB Every Call** (HIGH)
- **File:** `electron/backend/services/iMessageService.ts:432-434`
- **Impact:** Constant open/close cycle on dashboard status checks
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Reuse existing connection or cache result

#### **D3: Conversation Context Memory Leak** (MEDIUM)
- **File:** `electron/backend/services/AgentService.ts:16`
- **Impact:** Grows unbounded over weeks/months
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Implement TTL-based eviction (already partially done)

---

### Data Protection & Validation

#### **A4: No Authentication on Local API** (HIGH)
- **File:** `electron/backend/server.ts` (entire server)
- **Impact:** Any local process can read messages, send messages, steal API key
- **Fix Effort:** Medium (1–2 hours)
- **Fix Approach:** Add bearer token or session-based auth for sensitive endpoints
- **Note:** Known limitation, but should be documented and mitigated

#### **A5: `shell.openExternal` Without Validation** (HIGH)
- **File:** `electron/main.ts:92-94`
- **Impact:** `file://`, `javascript:`, custom protocol URLs pass through
- **Fix Effort:** Small (10 minutes)
- **Fix Approach:** Add scheme allowlist check

#### **A6: Unvalidated `shell.openExternal` in PermissionService** (HIGH)
- **File:** `electron/backend/services/PermissionService.ts:244-246`
- **Impact:** Public method accepts any string without validation
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Add URL allowlist validation

#### **A7: Secure Storage File Has Default Permissions** (MEDIUM)
- **File:** `electron/utils/secure-storage.ts:45,48`
- **Impact:** File readable by any user on system
- **Fix Effort:** Small (2 minutes)
- **Fix Approach:** Use `{ mode: 0o600 }` in `fs.writeFileSync()`

#### **A8: Plaintext Fallback for Encrypted Storage** (MEDIUM)
- **File:** `electron/utils/secure-storage.ts:25-28`
- **Impact:** API key stored as plaintext if encryption unavailable
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Add UI warning when encryption unavailable

#### **A9: No Input Validation on API Key Storage** (MEDIUM)
- **File:** `electron/backend/routes/dashboard.ts:451-456`
- **Impact:** Empty string, null, or 10MB string all accepted
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Validate format, length, non-empty before storage

#### **A10: Custom URL Scheme `textmyagent://` Unhandled** (MEDIUM)
- **File:** `electron-builder.yml:46-49`
- **Impact:** Registered but no handler; potential attack vector if handler added later
- **Fix Effort:** Small (5 minutes)
- **Fix Approach:** Remove if unused, or add handler with validation

---

## Part 3: Implementation Schedule

### Week 1: Critical Exploit Chain (P0)

**Objective:** Fix remote code execution vulnerability (A2 + A1 + A3)

| Task | File | Effort | Owner |
|------|------|--------|-------|
| Fix CORS substring matching | `server.ts:29-33` | 5 min | Backend |
| Fix command injection in `/settings/open` | `dashboard.ts:471-474` | 5 min | Backend |
| Remove SSE wildcard CORS header | `dashboard.ts:219` | 2 min | Backend |
| Add tests for CORS bypass prevention | `__tests__/` | 30 min | QA |
| Add tests for command injection prevention | `__tests__/` | 30 min | QA |
| Manual penetration testing | curl/Burp | 1 hour | Security |

**Deliverable:** All three fixes deployed, tested, and verified

---

### Week 1: Critical Functional Bugs (P1)

**Objective:** Fix critical bugs that break core functionality

| Task | File | Effort | Owner |
|------|------|--------|-------|
| Fix newline escaping (B1) | `iMessageService.ts:278-281` | 5 min | Backend |
| Fix attributedBody truncation (B2) | `iMessageService.ts:246-248` | 30 min | Backend |
| Fix app deadlock on quit (B3) | `main.ts:163-177` | 30 min | Backend |
| Fix concurrent message race (C1) | `AgentService.ts:99-103` | 30 min | Backend |
| Fix concurrent polling (C2) | `iMessageService.ts:112-114` | 10 min | Backend |
| Add regression tests | `__tests__/` | 1 hour | QA |
| Manual testing of all fixes | Manual | 1 hour | QA |

**Deliverable:** All critical bugs fixed, tested, and verified

---

### Week 2: High-Priority Bugs (P2)

**Objective:** Fix high-severity functional and performance issues

| Task | File | Effort | Owner |
|------|------|--------|-------|
| Fix conversation history (B4) | `iMessageService.ts:353-366` | 10 min | Backend |
| Fix config propagation (B5) | `dashboard.ts:178-193` | 5 min | Backend |
| Fix model mismatch (B6, B7) | README.md + `ClaudeService.ts` | 10 min | Backend |
| Fix agent processing after stop (B8) | `AgentService.ts:25-28` | 2 min | Backend |
| Fix DB connection leak (B9) | `iMessageService.ts:432-434` | 5 min | Backend |
| Fix Claude init failure (B10) | `ClaudeService.ts:29-43` | 10 min | Backend |
| Fix lastMessageRowId writes (D1) | `iMessageService.ts:168-169` | 5 min | Backend |
| Fix checkPermissions DB calls (D2) | `iMessageService.ts:432-434` | 10 min | Backend |
| Fix conversation memory leak (D3) | `AgentService.ts:16` | 10 min | Backend |
| Add regression tests | `__tests__/` | 1 hour | QA |

**Deliverable:** All high-priority bugs fixed and tested

---

### Week 2: Data Protection (A4–A10)

**Objective:** Harden data protection and input validation

| Task | File | Effort | Owner |
|------|------|--------|-------|
| Fix shell.openExternal validation (A5) | `main.ts:92-94` | 10 min | Backend |
| Fix PermissionService validation (A6) | `PermissionService.ts:244-246` | 5 min | Backend |
| Fix secure storage permissions (A7) | `secure-storage.ts:45,48` | 2 min | Backend |
| Add encryption unavailable warning (A8) | `secure-storage.ts:25-28` | 10 min | Backend |
| Add API key validation (A9) | `dashboard.ts:451-456` | 5 min | Backend |
| Remove/handle custom URL scheme (A10) | `electron-builder.yml:46-49` | 5 min | Backend |
| Plan local API auth (A4) | `server.ts` | 2 hours | Architecture |
| Add regression tests | `__tests__/` | 1 hour | QA |

**Deliverable:** All data protection issues addressed, auth plan created

---

### Week 3: Local API Authentication (A4)

**Objective:** Implement authentication for sensitive API endpoints

| Task | Effort | Owner |
|------|--------|-------|
| Design auth scheme (bearer token vs session) | 1 hour | Architecture |
| Implement auth middleware | 2 hours | Backend |
| Add auth to sensitive endpoints | 1 hour | Backend |
| Update dashboard to send auth token | 1 hour | Frontend |
| Add tests for auth bypass prevention | 1 hour | QA |
| Manual penetration testing | 1 hour | Security |

**Deliverable:** Local API authentication implemented and tested

---

### Week 4: Final Verification & Sign-Off

**Objective:** Comprehensive testing and security audit sign-off

| Task | Effort | Owner |
|------|--------|-------|
| Run full test suite (100+ tests) | 30 min | QA |
| Execute all SECURITY_TEST_PLAN.md test cases | 4 hours | Security |
| Penetration testing (CORS, injection, auth) | 4 hours | Security |
| Code review of all changes | 2 hours | Architecture |
| Update documentation | 1 hour | Docs |
| Create final security audit report | 2 hours | Security |
| Sign-off and release | 1 hour | PM |

**Deliverable:** Final security audit report, all tests passing, ready for production

---

## Part 4: Testing Strategy

### Unit Tests

**Add tests for each fix:**
- CORS bypass prevention
- Command injection prevention
- Newline escaping
- attributedBody parsing
- Concurrent message processing
- Concurrent polling
- Config propagation
- Auth bypass prevention

**Target:** 120+ tests (90 existing + 30 new)

### Dynamic Tests

**Tools:**
- curl for API endpoint testing
- Burp Suite for HTTP proxy/interceptor
- Playwright for automated UI testing
- Manual testing for AppleScript/iMessage

**Test Cases:**
- CORS with evil origins
- Command injection payloads
- Prompt injection vectors
- Rate limiting bypass
- Budget enforcement
- Memory leak detection
- Deadlock detection

### Penetration Testing

**Workflow:**
1. Reconnaissance: Map all endpoints, IPC channels
2. Static Analysis: Grep for dangerous patterns
3. Dynamic Testing: Interact with all endpoints
4. Injection Testing: Test all input vectors
5. Escalation: Chain findings
6. Documentation: Record findings

---

## Part 5: Risk Assessment

### High-Risk Areas

| Area | Risk | Mitigation |
|------|------|-----------|
| CORS bypass → command injection | RCE | Fix A2 + A1 immediately |
| Concurrent message processing | Data corruption | Fix C1 + C2 with tests |
| App deadlock on quit | User frustration | Fix B3 with timeout |
| Newline escaping | Broken messages | Fix B1 with tests |
| attributedBody truncation | Data loss | Fix B2 with tests |

### Medium-Risk Areas

| Area | Risk | Mitigation |
|------|------|-----------|
| No local API auth | Privilege escalation | Plan A4 for v2.0.3 |
| Memory leaks | Performance degradation | Fix D1–D3 |
| DB connection leaks | Resource exhaustion | Fix B9 + D2 |
| Config not propagating | Silent failures | Fix B5 |

---

## Part 6: Success Criteria

### Before v2.0.2 Release

- [ ] All 9 critical/high findings fixed (A1–A3, B1–B3, C1–C2, B4–B10, D1–D2)
- [ ] 120+ unit tests passing
- [ ] All SECURITY_TEST_PLAN.md test cases passing
- [ ] No new CVEs in dependencies
- [ ] Code signing + notarization verified
- [ ] Penetration testing completed
- [ ] Security audit report signed off

### Before v2.0.3 Release

- [ ] Local API authentication implemented (A4)
- [ ] All remaining medium-priority issues fixed
- [ ] 150+ unit tests
- [ ] Full penetration testing report

---

## Appendix: File Change Summary

### Files to Modify (Week 1–2)

| File | Changes | Priority |
|------|---------|----------|
| `electron/backend/server.ts` | Fix CORS, add auth | P0–P1 |
| `electron/backend/routes/dashboard.ts` | Fix command injection, SSE CORS | P0–P1 |
| `electron/backend/services/iMessageService.ts` | Fix newlines, attributedBody, DB leaks | P1–P2 |
| `electron/backend/services/AgentService.ts` | Fix concurrent processing, config, isRunning | P1–P2 |
| `electron/backend/services/ClaudeService.ts` | Fix init failure, usage logging | P2 |
| `electron/utils/secure-storage.ts` | Fix permissions, validation | P2 |
| `electron/main.ts` | Fix deadlock, shell.openExternal | P1–P2 |
| `electron-builder.yml` | Handle custom URL scheme | P2 |
| `README.md` | Update model info | P2 |
| `__tests__/` | Add 30+ new tests | All |

### Files to Create

| File | Purpose |
|------|---------|
| `__tests__/SecurityFixes.test.ts` | Tests for all fixes |
| `docs/SECURITY_AUDIT_SIGN_OFF.md` | Final audit report |

---

## Conclusion

This roadmap provides a **clear, prioritized path** to fixing all remaining security issues in TextMyAgent. By following this schedule, the application can be hardened to production-ready status within 4 weeks.

**Key Milestones:**
- **Week 1:** Fix critical exploit chain (A2 + A1 + A3) + critical bugs (B1–B3, C1–C2)
- **Week 2:** Fix high-priority bugs (B4–B10, D1–D3) + data protection (A5–A10)
- **Week 3:** Implement local API authentication (A4)
- **Week 4:** Final verification and sign-off

**Estimated Effort:** 60–80 hours total (backend, frontend, QA, security)

---

**Document Version:** 1.0  
**Created:** 2026-04-07  
**Status:** Ready for implementation
