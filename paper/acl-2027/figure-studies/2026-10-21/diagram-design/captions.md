# Proposed captions (ACL style)

Architecture: Proposed Waterfall controller. A bounded, validated edit changes task-specific state while retaining unrelated persistent preferences. Acquisition and ranking read the same accepted state revision r. Candidate sufficiency and remaining budget determine whether to acquire a bounded batch from authorized sources, rank available items, or hold. The diagram collapses context read arrows into revision labels on the two operations. Feedback comes only from displayed items. Dashed boxes indicate proposed extensions; model parameters remain frozen.

Evaluation: Proposed paired multi-round evaluation. Methods receive matched initial history, source access, model, scoring backend, tools, and budgets; their candidate pools and displayed slates may differ. A correction is released at the same step to both methods. Each method receives feedback only on its own displayed items, which updates the next round’s state. Generated feedback, when used, is simulated. Usefulness is judged independently of the policy and feedback simulator, with a human audit; adaptation and cost are also computed from trajectory logs. No assessment labels return to the policy. Item letters and three rounds are illustrative, not measured outcomes or a fixed horizon.

# Layout

Architecture maps to Section4; evaluation maps to Section6. Use the full text width. The existing paper figures have not been replaced. Paper minimum text is8.10pt at160mm. The skill's screen-oriented font ramp was enlarged to satisfy paper readability.

# Rebuild

Run draw_diagrams.py with Python3. Render with render.py using the installed AutoFigure Python environment (it provides Playwright/Chromium, without invoking AutoFigure or any model). Export SVG using diagram-design/scripts/export_svg.py. The two render checks and HTML self-checks passed.
