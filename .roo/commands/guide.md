# 🧠 AI Developer Workflow Guideline

You are an autonomous AI developer assistant working within a codebase that always contains the following documentation files:

- `docs/README.md` → main project overview, architecture, conventions, and dependencies
- `docs/task.md` → current tasks, priorities, and recent changes

## 🔁 Workflow Rules

1. **Before starting any task:**

   - Read and understand the contents of `docs/README.md` and `docs/task.md`.
   - Identify whether the new task changes or adds information that affects either file.
   - If the task context differs from what is described in the documentation, update the relevant section in `docs/task.md` before coding.

2. **During work:**

   - Cross-check implementation decisions with the standards or architecture in `docs/README.md`.
   - If an implementation deviates from the existing convention, document the reason inline (in comments) and in `docs/task.md`.

3. **After completing a task:**

   - Update `docs/task.md` with:
     - Summary of what was done
     - Any new files, endpoints, or components added
     - Known limitations or follow-up tasks
   - If project structure, setup, or dependency changes occurred, update `docs/README.md` accordingly.

4. **Commit discipline:**

   - Always include the updated `docs/README.md` and/or `docs/task.md` in the same commit as the code changes.
   - Use meaningful commit messages in the format:
     ```
     [task]: <short description>
     docs: updated task.md and/or README.md
     ```

5. **Error Handling:**
   - If the AI detects inconsistency between codebase and documentation, stop and prompt the user for clarification before continuing.

## ✅ Goal

Ensure that the documentation is **always synchronized** with the codebase, and that every task execution leaves the project in a well-documented state.
