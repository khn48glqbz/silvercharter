## Clean Code Guide for Silvercharter

This guide combines principles from Codacy’s “What is clean code?” and freeCodeCamp’s “How to write clean code,” prioritizing the rules that have the biggest impact on maintainability. Practices that can’t always be followed are marked as “best effort.”

### Core Principles (always enforce)

1. **Single responsibility everywhere**  
   - Every module, workflow, service, and function should do one job. If a function name includes “and” (e.g., “create…AndPublish”), refactor it into smaller helpers. This prevents hidden side effects and makes testing simpler.

2. **No duplication**  
   - Never copy/paste logic. Shared behavior belongs in a utility, service, or workflow. Duplicate code is a bug generator.

3. **Intention-revealing names**  
   - Names must tell you “why” the code exists, not “how.” Prefer `saveProduct`, `publishProduct`, `selectGame`, etc. Avoid vague or abbreviated names.
   - Keep naming consistent: workflows end with `-workflow`, services with `-service`, CLI flows under `src/cli/flows`.

4. **Separation of concerns**  
   - CLI prompts (UI), workflows (business orchestration), adapters (Shopify/PriceCharting I/O), and utilities each live in their own layer. Keep cross-layer imports to a minimum to avoid tangled dependencies.

5. **Explicit dependencies**  
   - Pass required data (config, CSV paths, etc.) into functions instead of pulling from globals dynamically. This makes behavior predictable and easier to test.

6. **Consistent data flow**  
   - Use plain data objects for inputs/outputs. Workflows should not read directly from `inquirer` or mutate shared state silently.

7. **Defensive boundaries**  
   - Validate input at entry points: check URL formats, numeric ranges, mandatory strings. Fail fast with clear messages, but avoid noisy logging.

8. **Document architecture**  
   - Keep `docs/workflow-notes.md` and this guide current so future contributors understand the layout and expectations.

### Best-Effort Practices

9. **Keep functions short**  
   - Aim for functions under ~40 lines. If a function grows, look for smaller steps to extract. Sometimes a loop or prompt definition will push a function over this limit—clean up as soon as it becomes unwieldy.

10. **Pure functions first**  
   - Utilities (e.g., currency conversion, pricing rules) should avoid side effects. Pure functions are easier to test and reuse.

11. **Meaningful comments (when needed)**  
   - Write code that explains itself. Only comment when the “why” isn’t obvious or when describing a non-trivial algorithm.

12. **Consistent formatting**  
   - Use two-space indentation (as in the existing code) and keep whitespace consistent to avoid noisy diffs.

13. **Review naming with fresh eyes**  
   - Before committing new functions, ask: “Would someone unfamiliar with this module understand this name immediately?” If not, rename it.

14. **Continuous refactoring**  
   - Revisiting older modules is encouraged. As new patterns emerge, update legacy code to match. Run `npm start` (and any future tests) after refactors to ensure nothing regresses.

15. **Composition over inheritance**  
   - Build functionality by composing small helpers/services, not by piling behavior into large classes or multi-purpose modules.

16. **Error handling with context**  
   - Catch errors close to where they occur, log enough context to debug (URL, product title, etc.), and rethrow or return a meaningful message upstream.

By following these principles, the Silvercharter codebase stays readable, testable, and flexible—ready for new features or even a future UI beyond the CLI.
