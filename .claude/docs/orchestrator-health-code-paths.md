# Orchestrator Health System - Code Paths

## 1. ORCHESTRATOR DEPLOYS TASK

**File:** `src/extension/orchestrator/orchestratorServiceV2.ts`

| Step | Function | Line |
|------|----------|------|
| Entry | `deploy(taskId, options)` | 2429 |
| Build instructions | `_buildWorkerInstructions()` | 2501 |
| Create worker | `new WorkerSession(...)` | 2651 |
| Start task | `_runWorkerTask(worker, task)` | 2713 |

---

## 2. RUNNING THE TASK

**File:** `src/extension/orchestrator/orchestratorServiceV2.ts`

| Step | Function | Line |
|------|----------|------|
| Entry | `_runWorkerTask(worker, task)` | 3603 |
| Start health monitoring | `_healthMonitor.startMonitoring(worker.id)` | 3612 |
| Dispatch to executor | `_runExecutorBasedTask(...)` | 3635 |

---

## 3. EXECUTOR LOOP

**File:** `src/extension/orchestrator/orchestratorServiceV2.ts`

| Step | Function | Line |
|------|----------|------|
| Entry | `_runExecutorBasedTask(worker, task, parsedAgentType, circuitBreaker)` | 3930 |
| Main loop | `while (worker.isActive)` | 3996 |
| Check if idle at top | `if (worker.status === 'idle')` | 3998 |
| Wait for message | `worker.waitForClarification()` | 3999 |
| Capture token | `iterationToken = worker.cancellationToken` | 4008 |
| Mark execution start | `_healthMonitor.markExecutionStart(worker.id)` | 4027 |
| Call executor | `executor.execute({...})` | 4035 |
| Mark execution end | `_healthMonitor.markExecutionEnd(worker.id)` | 4059 |
| Check if interrupted | `if (iterationToken.isCancellationRequested)` | 4065 |
| Go idle after success | `worker.idle()` | 4123 |
| Wait for next message | `worker.waitForClarification()` | 4125 |

---

## 4. CLAUDE EXECUTOR

**File:** `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts`

| Step | Function | Line |
|------|----------|------|
| Entry | `execute(params, stream)` | ~80 |
| Get/create session | `_claudeAgentManager.getOrCreateWorktreeSession(worktreePath)` | 123 |
| Set worker context | `session.session.setWorkerContext(workerContext)` | 130 |
| Cancellation listener | `token.onCancellationRequested(() => session.session.abort())` | 167-170 |
| Invoke Claude | `session.session.invoke(fullPrompt, ...)` | 177 |

---

## 5. CLAUDE SESSION (THE QUEUE)

**File:** `src/extension/agents/claude/node/claudeCodeAgent.ts`

| Step | Function | Line |
|------|----------|------|
| Class | `ClaudeCodeSession` | 327 |
| Queue field | `_promptQueue: QueuedRequest[]` | 330 |
| Generator field | `_queryGenerator: Query \| undefined` | 329 |
| Pending prompt field | `_pendingPrompt: DeferredPromise` | 332 |
| Abort method | `abort()` | 391 |
| Invoke method | `invoke(prompt, ...)` | 412 |
| Check if need session | `if (!this._queryGenerator)` | 422 |
| Start session | `_startSession(token)` | 423 |
| Push to queue | `_promptQueue.push(request)` | 436 |
| Wake waiting loop | `_pendingPrompt.complete(request)` | 451 |
| Start session | `_startSession(token)` | 460 |
| Create generator | `_queryGenerator = await claudeCodeService.query({...})` | 560 |
| Start message loop | `_processMessages()` | 566 |
| Prompt generator | `_createPromptIterable()` | 594 |
| Get next request | `_getNextRequest()` | 624 |
| Message loop | `_processMessages()` | 638 |
| For-await loop | `for await (const message of this._queryGenerator!)` | 641 |
| Check cancellation | `if (this._currentRequest?.token.isCancellationRequested)` | 643 |
| Complete request | `completedRequest.deferred.complete()` | 661 |
| **Session recovery fix** | `this._queryGenerator = undefined` | 674 |

---

## 6. HEALTH MONITOR

**File:** `src/extension/orchestrator/workerHealthMonitor.ts`

| Step | Function | Line |
|------|----------|------|
| Class | `WorkerHealthMonitor` | 102 |
| Metrics map | `_metrics: Map<string, IWorkerHealthMetrics>` | 108 |
| Config (timeouts) | `_config: HealthMonitorConfig` | 109 |
| Start monitoring | `startMonitoring(workerId)` | 164 |
| Record activity | `recordActivity(workerId, type, toolName?)` | 230 |
| Mark execution start | `markExecutionStart(workerId)` | 371 |
| Mark execution end | `markExecutionEnd(workerId)` | 380 |
| Mark idle inquiry sent | `markIdleInquirySent(workerId)` | 320 |
| Mark progress check sent | `markProgressCheckSent(workerId)` | 352 |
| **Periodic check** | `_checkStuckWorkers()` | 392 |
| Idle check condition | `if (!isIdle && !isStuck && !idleInquiryPending && !isExecuting && timeSinceActivity > idleTimeoutMs)` | 420-421 |
| Fire idle event | `_onWorkerIdle.fire(...)` | 424 |
| Progress check condition | `if (!isStuck && isExecuting && timeSinceProgressCheck > progressCheckIntervalMs)` | 432 |
| Fire progress event | `_onProgressCheckDue.fire(...)` | 435 |
| Stuck check condition | `if (!isStuck && timeSinceActivity > stuckTimeoutMs)` | 440 |
| Fire unhealthy event | `_onWorkerUnhealthy.fire(...)` | 443 |

---

## 7. HEALTH EVENT HANDLERS

**File:** `src/extension/orchestrator/orchestratorServiceV2.ts`

| Step | Function | Line |
|------|----------|------|
| Subscribe to idle | `_healthMonitor.onWorkerIdle(event => _handleIdleWorker(...))` | 632-634 |
| Subscribe to progress | `_healthMonitor.onProgressCheckDue(event => _handleProgressCheck(...))` | 638-640 |
| Handle idle | `_handleIdleWorker(workerId, reason)` | 726 |
| Handle progress check | `_handleProgressCheck(workerId)` | 856 |
| Interrupt worker | `worker.interrupt()` | 930 |
| Send clarification | `worker.sendClarification(progressMessage)` | 937 |

---

## 8. WORKER SESSION

**File:** `src/extension/orchestrator/workerSession.ts`

| Step | Function | Line |
|------|----------|------|
| Class | `WorkerSession` | ~400 |
| Pending clarification field | `_pendingClarification?: string` | 402 |
| Cancellation source field | `_cancellationTokenSource` | 406 |
| Get cancellation token | `get cancellationToken()` | 490 |
| Interrupt | `interrupt()` | 499 |
| Cancel old token | `_cancellationTokenSource.cancel()` | 514 |
| Create new token | `_cancellationTokenSource = new CancellationTokenSource()` | 517 |
| Set status idle | `_status = 'idle'` | 520 |
| Send clarification | `sendClarification(message)` | 1186 |
| Deliver immediately | `resolve(message)` | 1194 |
| Queue for later | `_pendingClarification = message` | 1199 |
| Wait for clarification | `waitForClarification()` | 1267 |
| Return queued message | `return _pendingClarification` | 1270-1273 |
| Wait for new message | `return new Promise(resolve => _clarificationResolve = resolve)` | 1284-1286 |

---

## FLOW SUMMARY WITH LINE NUMBERS

```
DEPLOY:
orchestratorServiceV2.ts:2429 deploy()
    → orchestratorServiceV2.ts:2713 _runWorkerTask()
        → orchestratorServiceV2.ts:3612 _healthMonitor.startMonitoring()
        → orchestratorServiceV2.ts:3635 _runExecutorBasedTask()

EXECUTOR LOOP:
orchestratorServiceV2.ts:3996 while (worker.isActive)
    → orchestratorServiceV2.ts:4027 _healthMonitor.markExecutionStart()
    → orchestratorServiceV2.ts:4035 executor.execute()
        → claudeCodeAgentExecutor.ts:167 token.onCancellationRequested → abort()
        → claudeCodeAgentExecutor.ts:177 session.invoke()
            → claudeCodeAgent.ts:422 if (!_queryGenerator) → _startSession()
            → claudeCodeAgent.ts:436 _promptQueue.push(request)
            → claudeCodeAgent.ts:641 for await (message of _queryGenerator)
            → claudeCodeAgent.ts:674 catch: _queryGenerator = undefined  ← FIX
    → orchestratorServiceV2.ts:4059 _healthMonitor.markExecutionEnd()

HEALTH CHECK (every 30s):
workerHealthMonitor.ts:392 _checkStuckWorkers()
    → workerHealthMonitor.ts:420-424 idle check → fire onWorkerIdle
    → workerHealthMonitor.ts:432-435 progress check → fire onProgressCheckDue

PROGRESS CHECK HANDLER:
orchestratorServiceV2.ts:638-640 onProgressCheckDue subscription
    → orchestratorServiceV2.ts:856 _handleProgressCheck()
        → orchestratorServiceV2.ts:930 worker.interrupt()
            → workerSession.ts:514 _cancellationTokenSource.cancel()
            → workerSession.ts:517 new CancellationTokenSource()
            → workerSession.ts:520 _status = 'idle'
        → orchestratorServiceV2.ts:937 worker.sendClarification()
            → workerSession.ts:1199 _pendingClarification = message

BACK IN EXECUTOR LOOP:
orchestratorServiceV2.ts:4065 iterationToken.isCancellationRequested → continue
orchestratorServiceV2.ts:3998 worker.status === 'idle'
orchestratorServiceV2.ts:3999 worker.waitForClarification()
    → workerSession.ts:1270 return _pendingClarification
orchestratorServiceV2.ts:4003 currentPrompt = progressMessage
orchestratorServiceV2.ts:4035 executor.execute(progressMessage)
    → claudeCodeAgent.ts:422 _queryGenerator undefined → _startSession()  ← FIX ENABLES THIS
```

---

## ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                                  │
│  deploy() → _runWorkerTask() → _runExecutorBasedTask()              │
│                    │                      │                          │
│                    │                      └── while(worker.isActive) │
│                    │                              │                  │
│  HealthMonitor ←───┼── recordActivity()           │                  │
│       │            │   markExecutionStart/End()   │                  │
│       │            │                              │                  │
│  _checkStuckWorkers() every 30s                   │                  │
│       │                                           │                  │
│       ├── onWorkerIdle ─────→ _handleIdleWorker() │                  │
│       └── onProgressCheckDue → _handleProgressCheck()                │
│                                    │                                 │
│                        worker.interrupt()                            │
│                        worker.sendClarification()                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WORKER SESSION                                │
│  _pendingClarification ← message queued here                        │
│  _clarificationResolve ← resolved when worker.waitForClarification()│
│                                                                      │
│  interrupt() → cancels token, creates new one, status='idle'        │
│  sendClarification() → queue or deliver immediately                 │
│  waitForClarification() → return pending or wait                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CLAUDE CODE AGENT EXECUTOR                      │
│  execute() → getOrCreateWorktreeSession()                           │
│            → token.onCancellationRequested → session.abort()        │
│            → session.invoke(prompt)                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CLAUDE CODE SESSION                            │
│  _promptQueue[]     ← requests waiting to be processed              │
│  _queryGenerator    ← SDK iterator (yields messages from Claude)    │
│  _pendingPrompt     ← promise waiting for next request              │
│                                                                      │
│  invoke() → push to queue, wake _createPromptIterable if waiting    │
│                                                                      │
│  _processMessages() loop:                                           │
│      for await (msg of _queryGenerator)                             │
│          handle message                                             │
│          on 'result' → shift from queue, complete deferred          │
│      catch(error):                                                  │
│          _queryGenerator = undefined  ← SESSION RECOVERY FIX        │
│                                                                      │
│  abort() → abortController.abort(), reject current request          │
└─────────────────────────────────────────────────────────────────────┘
```
