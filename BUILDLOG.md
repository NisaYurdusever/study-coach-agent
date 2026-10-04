# Checkpoint 1: Build Log & Scope Audit

### 1. Build Narrative & What Broke
* **Hour 1 - 2 (Initial Wireup):** Started implementing the CLI agent loop using `@google/genai` and Node.js `readline`. The initial attempt used a single monolithic turn, which broke because tool outputs require an explicit `functionResponse` message back into the conversation history before the model can generate natural text. Resolved by wrapping the tool execution into a `while (response.functionCalls)` loop.
* **Hour 3 (Tool Definition Discrepancy):** Defined `read_study_material` with optional arguments, causing the model to occasionally hallucinate arbitrary parameters like `page_number`. Fixed by hardening the JSON Schema with `required: ['topic']` and strict typing.
* **Hour 4 (End-to-End Loop Validation):** The model occasionally tried to evaluate candidate responses without calling `update_progress_ledger`. Enforced step 3 in `systemInstruction` ("You must call update_progress_ledger after grading"), successfully making the persistent write automatic.

### 2. Deviations from the FL-06 Spec
* **Cut Feature - `run_code_syntax_check` sandbox:** The original spec called for a child-process syntax checker tool. For this MVP Checkpoint, I cut the execution sandbox to keep the build strictly focused on grounded Q&A and persistent ledger logging. The scope was reduced to ensure bulletproof reliability within the ~10 build hours boundary.
* **Storage Simplification:** Switched from a planned SQLite database to a flat `progress_ledger.json` file. This eliminated binary driver dependencies while satisfying the requirement for live file mutation.

### 3. Verification of Live Connections
* **Live Ingestion:** Agent opens and reads `knowledge_base.txt` using the Node.js `fs` module via `read_study_material`.
* **Live Mutation:** Agent appends timestamps, numeric scores (e.g., 90/100), and qualitative notes to `progress_ledger.json`.