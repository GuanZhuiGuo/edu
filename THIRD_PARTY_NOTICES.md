# Third-party notices

The knowledge-material studio includes pinned source code from the following
open-source projects. Upstream source and its original license are pinned as
Git submodules under `third_party/`; use `git clone --recurse-submodules` or
`git submodule update --init --recursive` to retrieve them. Generated lesson data remains separate from the application's
A2UI teaching-card protocol.

## DeepTutor

- Project: https://github.com/HKUDS/DeepTutor
- Included revision: `47d05809ea5d19e8b1390d4b42402302c37709bb`
- License: Apache License 2.0
- Copyright: 2025 Data Intelligence Lab, The University of Hong Kong

The pinned Python source is included at `third_party/deeptutor`. The material
studio bridge executes the upstream Book Engine's `SpineSynthesizer`
Draft → Critique → Revise flow and its deterministic chapter-map/overview
logic. For each regular chapter it also compiles the first upstream-planned
`SECTION` through `BookCompiler` and `SectionGenerator`. Optional quiz,
visualization, interactive, and animation generator stacks are not executed by
this host compatibility profile. The public result retains DeepTutor's native
Book, Spine, Page, Block, SourceAnchor, and ConceptGraph structures; it is not
converted to A2UI.

The original Apache-2.0 license is preserved at
`third_party/deeptutor/LICENSE`.

## OpenMAIC

- Project: https://github.com/THU-MAIC/OpenMAIC
- Included revision: `fcdb6d62b380c066de2a4733910669c9e697b83a`
- Included version: `0.3.0`
- License: MIT
- Copyright: 2026 THU-MAIC

The pinned TypeScript source is included at `third_party/openmaic`. The
material studio bridge executes the upstream outline, scene-content, action,
and `createSceneWithActions` generation path with an injected host LLM
boundary. The public result retains OpenMAIC's native Stage, Scene, Canvas, and
Action structures; it is not converted to A2UI.

The original MIT license is preserved at `third_party/openmaic/LICENSE`.

## Cell Architecture Studio

- Project: https://github.com/cclank/cell-architecture-studio
- Studied revision: `1cab982e7a0f96af854a696430c0724707764358`
- License for application code: MIT
- Copyright: 2026 cclank

The local spatial viewer reimplements the object → part → focus interaction
pattern over generated primitive geometry. Upstream GLB models, images, and
other separately licensed assets are not included.

## Three.js

- Project: https://github.com/mrdoob/three.js
- Version: 0.181.2
- License: MIT
- Copyright: 2010-2026 three.js authors

## MIT license text

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Koji

Brilliant's Koji is proprietary and no source code or assets are included.
The local tutor behavior is an original implementation based only on publicly
described pedagogical behavior: progressive hints, awareness of learner
interaction state, and reduced assistance as mastery increases.
