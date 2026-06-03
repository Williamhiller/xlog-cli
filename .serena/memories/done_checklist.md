# Done checklist
- For viewer/UI changes, rebuild with `rtk npm run build:viewer`.
- If behavior changed beyond styling, run the smallest relevant test(s), then broader `rtk npm test` if needed.
- Verify that `/viewer/` still serves built `viewer-react/dist` assets.
- Summarize impact in terms of capture/session/log/viewer behavior for future agent handoff.