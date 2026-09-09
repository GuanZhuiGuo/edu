# Cell Architecture Studio source adapter notice

This adapter is derived from application code and structured specimen data in:

- Project: `cclank/cell-architecture-studio`
- Repository: <https://github.com/cclank/cell-architecture-studio>
- Studied revision: `1cab982e7a0f96af854a696430c0724707764358`
- License: MIT
- Source files:
  - `src/data/cells.ts`
  - `src/components/CellScene.tsx`
  - `src/components/Stage.tsx`
  - `LICENSE`

The adapter ports the seven-specimen `CellItem`/`OrganelleItem` model, the
deterministic `Dots` placement formula, representative procedural primitive
placements, and the source camera defaults into the host application's
`spatial_scene` contract.

No upstream GLB, PNG, preview, NIH, or other binary asset is copied. Those
assets retain the separate provenance documented by the upstream project.
Because the source project is a curated cell gallery—not a generic
text-to-3D engine—the adapter intentionally rejects unrelated or ambiguous
source text instead of fabricating a generic Cell-Studio-like scene.

## MIT License

Copyright (c) 2026 cclank

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
