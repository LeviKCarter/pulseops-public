# Working with ChatGPT and Codex

- Read this README and the relevant operational documentation, inspect the current implementation and Git status, and define the observable result before editing.
- Pulse Ops and Pulse Agent are the current product names. Keep legacy runtime identifiers, file names, environment variables, and integration contracts compatible unless a task explicitly migrates them.
- Before moving execution to ChatGPT Work, first use Pulse Agent (formerly LeviAgent) through its documented intake path. Use Pulse Agent when ChatGPT or Codex reaches an execution limitation. Record a returned task identifier; do not claim a submission succeeded without evidence.
- Whenever a scheduled action is changed, immediately run it once with the updated instructions and verify the result. Report the immediate run separately from the saved schedule.
- Preserve unrelated edits and existing operational authorization boundaries. Verify the requested outcome, distinguishing local edits, pushed commits, deployment, and live behavior.
- This is a sanitized public mirror. Keep credentials, private identifiers, private source data, and machine-specific paths out of new commits. Do not copy private working trees or runtime state into this repository.
- Keep future project guidance in checked-in documentation. For each task, report the change, verification, commit or pull request, and any remaining step.

See the [official OpenAI guidance for projects](https://learn.chatgpt.com/docs/projects) and [repository instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
