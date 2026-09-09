# OpenMAIC DSL source attribution

The host application integrates the official `@openmaic/dsl@0.3.0` package
published from `THU-MAIC/OpenMAIC`.

- Repository: <https://github.com/THU-MAIC/OpenMAIC>
- Studied revision: `ff95e6683db44ce7d4b362283e589c0a157f0364`
- Package: `packages/@openmaic/dsl`
- Package version: `0.3.0`
- Package license: MIT
- Reused source:
  - `src/stage.ts`
  - `src/action.ts`
  - `src/normalize.ts`
  - `src/validate.ts`

The adapter calls the package’s Stage/Scene normalizers and Stage/Scene/Action
validators at runtime. It does not copy or run the AGPL application shell,
multi-agent server, model prompts, or media assets.

## MIT License

Copyright (c) 2026 THU-MAIC

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
