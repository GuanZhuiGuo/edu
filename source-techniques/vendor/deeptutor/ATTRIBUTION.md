# DeepTutor source attribution

This directory documents the DeepTutor code port used by
`source-techniques/deeptutor-adapter.js`.

- Upstream project: <https://github.com/HKUDS/DeepTutor>
- Studied source revision: `47d05809ea5d19e8b1390d4b42402302c37709bb`
- Upstream release at that revision: `v1.5.5`
- License: Apache License 2.0
- Copyright: 2025 Data Intelligence Lab, The University of Hong Kong

## Ported deterministic source

| Upstream file | Ported behaviour |
| --- | --- |
| `deeptutor/book/blocks/concept_graph.py` | `_safe_id`, `_escape_label`, and `render_mermaid` |
| `deeptutor/book/agents/spine_synthesizer.py` | chapter-level map construction from chapter/concept ownership |
| `deeptutor/book/engine.py` | deterministic Overview chapter, concept graph block, and chapter index materialisation |
| `deeptutor/book/agents/page_planner.py` | the `ContentType.CONCEPT` static block plan |

The port changes Python/Pydantic objects into dependency-free JavaScript plain
objects and adapts identifiers to the host project's existing technique
contract. The resulting source is therefore a modified work.

## Deliberately not claimed as an upstream capability

DeepTutor's `SourceExplorer` and `SpineSynthesizer` use LLM calls to derive
semantic concepts and chapters. This Node application does not embed the
DeepTutor Python runtime. Its small local source compiler splits only the
provided text, preserves source anchors, and then passes those sections into
the ported deterministic Book Engine behaviours. It does not imitate
DeepTutor's LLM prompts and does not describe those local splits as official
DeepTutor semantic output.

No DeepTutor media assets, generated course content, Python dependencies, or
model prompts are included.

The complete Apache License 2.0 text is available in `LICENSE` beside this
file and at <https://www.apache.org/licenses/LICENSE-2.0>.
