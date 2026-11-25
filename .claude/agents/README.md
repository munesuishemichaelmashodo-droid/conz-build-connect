# Agents: who does what

| Agent | Writes code? | Use it for |
|---|---|---|
| software-architect | no | Plans for changes spanning several layers; technology choices |
| senior-frontend-engineer | yes | Screens, components, client logic |
| backend-engineer | yes | Server functions, SQL functions, edge functions, integrations |
| database-engineer | yes (files only) | Schema, RLS, grants, indexes, migrations + undo + pgTAP |
| ui-ux-designer | no | Flows, screen proposals, copy, accessibility |
| cybersecurity-specialist | no | Threat model, scanners, RLS/grant review, OWASP |
| qa-engineer | yes (tests) | Test plans and running every suite |
| performance-engineer | yes | Measured speed work (bundle, vitals, queries) |
| product-research-analyst | no | Idea validation, competitors, requirements, feasibility |
| independent-code-reviewer | no | Fresh-eyes review before merge |
| payment agents (existing) | no | Paynow / commission audits, provider and compliance research |

## Standard flow for a feature

1. **product-research-analyst** (only if the problem or market is unclear) -> problem, evidence, acceptance criteria.
2. **software-architect** -> plan with files, migrations, tests, risks, owner decisions.
3. **ui-ux-designer** for new screens -> flow and copy.
4. **database-engineer** / **backend-engineer** / **senior-frontend-engineer** build in that order, each with tests.
5. **qa-engineer** runs everything; **performance-engineer** if the change touches load paths.
6. **cybersecurity-specialist** for auth, money, uploads, public endpoints or new dependencies.
7. **independent-code-reviewer** last. Its findings go back to the builder; it never fixes them itself.
8. The owner decides merge, deploy and migrations. No agent does those.

## Collaboration rules

- Hand-offs carry evidence: file:line references, commands run and their output counts, and what was not checked.
- A reviewer never reviews its own work. Builders do not mark their own work "verified".
- Disagreements go to the owner with both positions written down, not resolved by the louder agent.
- Agents start cold: give them the goal, the branch, relevant files and constraints in the prompt.
- Spawning agents costs time and tokens: use one for a clearly separate job (review, research, parallel independent work), not for every step.
