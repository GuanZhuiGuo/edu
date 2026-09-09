#!/usr/bin/env python3
"""Run the pinned upstream DeepTutor Book Engine over one source document.

Protocol
--------
The first stdin line is always one JSON request.

Environment mode writes one JSON result line to stdout and obtains the model
configuration exclusively from process environment variables.

RPC mode is a bidirectional JSON-lines protocol. For every upstream LLM stage
the bridge writes an ``llm_request`` line and waits for a matching
``llm_response`` line on stdin. The final line has type ``result``. This lets a
Node parent keep an API key in its own in-memory client; the Python process
never receives that key.

The returned ``native_result`` is composed of upstream Pydantic Book, Spine,
Page, Block, and ExplorationReport dumps. It is not projected into the host
application's material, card, or A2UI contracts.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import traceback
from typing import Any, TextIO


BRIDGE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BRIDGE_DIR.parents[1]
UPSTREAM_DIR = PROJECT_DIR / "third_party" / "deeptutor"
DEPS_DIR = BRIDGE_DIR / "python_deps"
PINNED_COMMIT = "47d05809ea5d19e8b1390d4b42402302c37709bb"
PINNED_TAG = "v1.5.5"
PROTOCOL_OUT = sys.stdout

# Keep all upstream runtime lookups inside this isolated bridge directory.
os.environ["DEEPTUTOR_HOME"] = str(BRIDGE_DIR)

for import_root in (str(DEPS_DIR), str(UPSTREAM_DIR)):
    if import_root not in sys.path:
        sys.path.insert(0, import_root)

# Keep stdout protocol-clean even if an upstream dependency prints at import.
with contextlib.redirect_stdout(sys.stderr):
    from deeptutor.book.agents.page_planner import PagePlanner
    from deeptutor.book.agents.spine_synthesizer import SpineSynthesizer
    from deeptutor.book.compiler import BookCompiler, CompilerOptions
    from deeptutor.book.engine import BookEngine
    from deeptutor.book.models import (
        BlockStatus,
        BlockType,
        Book,
        BookProposal,
        BookStatus,
        ExplorationReport,
        Page,
        PageStatus,
        SourceChunk,
        Spine,
    )


class BridgeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MemoryBookStorage:
    """Small storage implementation for upstream ``BookEngine.confirm_spine``."""

    def __init__(self) -> None:
        self.books: dict[str, Book] = {}
        self.spines: dict[str, Spine] = {}
        self.pages: dict[str, dict[str, Page]] = {}
        self.logs: list[dict[str, str]] = []

    def save_book(self, book: Book) -> None:
        self.books[book.id] = book

    def load_book(self, book_id: str) -> Book | None:
        return self.books.get(book_id)

    def save_spine(self, spine: Spine) -> None:
        self.spines[spine.book_id] = spine

    def load_spine(self, book_id: str) -> Spine | None:
        return self.spines.get(book_id)

    def save_page(self, page: Page) -> None:
        self.pages.setdefault(page.book_id, {})[page.id] = page

    def load_page(self, book_id: str, page_id: str) -> Page | None:
        return self.pages.get(book_id, {}).get(page_id)

    def list_pages(self, book_id: str) -> list[Page]:
        return sorted(
            self.pages.get(book_id, {}).values(),
            key=lambda page: page.order,
        )

    def append_log(self, book_id: str, message: str, *, op: str = "") -> None:
        self.logs.append({"book_id": book_id, "message": message, "op": op})


class RpcModelGateway:
    """Serialize official DeepTutor LLM calls over the existing JSONL channel."""

    def __init__(self, protocol_in: TextIO, protocol_out: TextIO):
        self._protocol_in = protocol_in
        self._protocol_out = protocol_out
        self._request_index = 0

    async def call_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        stage: str,
        schema: dict[str, Any] | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        self._request_index += 1
        request_id = f"llm_{self._request_index}"
        _write_json(
            {
                "type": "llm_request",
                "request_id": request_id,
                "stage": stage,
                "system": system_prompt,
                "prompt": user_prompt,
                "schema": schema,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "response_format": {"type": "json_schema" if schema else "json_object"},
            },
            stream=self._protocol_out,
        )
        response = _read_json_line(self._protocol_in)
        if (
            response.get("type") != "llm_response"
            or response.get("request_id") != request_id
        ):
            raise BridgeError(
                "INVALID_RPC_RESPONSE",
                "LLM callback returned an invalid or mismatched response",
            )
        if response.get("error"):
            raise BridgeError("RPC_LLM_FAILED", "The parent LLM callback failed")
        payload = response.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise BridgeError(
                    "INVALID_RPC_RESPONSE",
                    "LLM callback payload was not valid JSON",
                ) from exc
        if not isinstance(payload, dict):
            raise BridgeError(
                "INVALID_RPC_RESPONSE",
                "LLM callback payload must be a JSON object",
            )
        return payload

    async def call_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        stage: str,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        payload = await self.call_json(
            system_prompt=system_prompt,
            user_prompt=(
                f"{user_prompt}\n\n"
                "Return the requested prose in the JSON field `content`."
            ),
            stage=stage,
            schema={
                "type": "object",
                "additionalProperties": False,
                "required": ["content"],
                "properties": {
                    "content": {
                        "type": "string",
                        "minLength": 1,
                    }
                },
            },
            max_tokens=max_tokens,
            temperature=temperature,
        )
        content = payload.get("content")
        if not isinstance(content, str) or not content.strip():
            raise BridgeError(
                "INVALID_RPC_RESPONSE",
                "LLM callback text payload must contain non-empty content",
            )
        return content.strip()


class RpcSpineSynthesizer(SpineSynthesizer):
    """Upstream synthesizer whose JSON completion crosses the JSONL boundary."""

    def __init__(self, gateway: RpcModelGateway, **kwargs: Any):
        super().__init__(
            api_key="rpc-key-not-a-secret",
            base_url="http://rpc.invalid/v1",
            binding="openai",
            **kwargs,
        )
        self.model = "rpc-callback"
        self._gateway = gateway

    async def _call_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        stage: str,
    ) -> dict[str, Any]:
        return await self._gateway.call_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            stage=stage,
        )


def _read_json_line(stream: TextIO) -> dict[str, Any]:
    line = stream.readline()
    if not line:
        raise BridgeError("EMPTY_INPUT", "Expected a JSON line on stdin")
    try:
        value = json.loads(line)
    except json.JSONDecodeError as exc:
        raise BridgeError("INVALID_JSON", "Input was not valid JSON") from exc
    if not isinstance(value, dict):
        raise BridgeError("INVALID_INPUT", "Input JSON must be an object")
    return value


def _write_json(value: dict[str, Any], *, stream: TextIO = PROTOCOL_OUT) -> None:
    stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()


TRACE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
TRACE_STATUSES = {
    "pending",
    "started",
    "running",
    "streaming",
    "retrying",
    "completed",
    "failed",
    "cancelled",
    "info",
    "warning",
}
TRACE_META_KEYS = {
    "round_label",
    "chapter_count",
    "issue_count",
    "verdict",
    "page_id",
    "chapter_id",
    "page_index",
    "page_count",
    "block_id",
    "block_type",
    "block_count",
    "ready_block_count",
    "kind",
    "upstream_stage",
    "payload_keys",
    "error_code",
}


def _safe_trace_token(value: Any) -> str:
    return (
        value
        if isinstance(value, str) and TRACE_TOKEN_PATTERN.fullmatch(value)
        else ""
    )


def _safe_trace_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(
        character
        for character in value
        if character >= " " or character in "\t\n"
    )[:limit]


def _sanitize_trace_meta(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    safe: dict[str, Any] = {}
    for key, item in value.items():
        if key not in TRACE_META_KEYS:
            continue
        if isinstance(item, bool):
            safe[key] = item
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            if item == item and item not in {float("inf"), float("-inf")}:
                safe[key] = item
        elif isinstance(item, str):
            safe[key] = _safe_trace_text(item, 200)
        elif isinstance(item, list):
            safe[key] = [
                _safe_trace_text(entry, 200) if isinstance(entry, str) else entry
                for entry in item[:20]
                if isinstance(entry, (str, int, float, bool))
            ]
    return safe


def _emit_trace(
    *,
    event_type: str,
    stage: str,
    status: str,
    title: str,
    message: str = "",
    call_id: str = "",
    meta: dict[str, Any] | None = None,
) -> None:
    """Write one protocol-safe trace event without model or source content."""

    safe_type = _safe_trace_token(event_type)
    safe_stage = _safe_trace_token(stage)
    safe_status = status if status in TRACE_STATUSES else ""
    safe_title = _safe_trace_text(title, 160)
    if (
        not safe_type
        or not safe_stage.startswith("deeptutor.")
        or not safe_status
        or not safe_title
    ):
        return
    event: dict[str, Any] = {
        "type": safe_type,
        "stage": safe_stage,
        "status": safe_status,
        "title": safe_title,
    }
    safe_message = _safe_trace_text(message, 800)
    safe_call_id = _safe_trace_token(call_id)
    safe_meta = _sanitize_trace_meta(meta)
    if safe_message:
        event["message"] = safe_message
    if safe_call_id:
        event["call_id"] = safe_call_id
    if safe_meta:
        event["meta"] = safe_meta
    _write_json({"type": "trace", "event": event}, stream=PROTOCOL_OUT)


def _first_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _environment_config() -> dict[str, str]:
    config = {
        "api_key": _first_env(
            "DEEPTUTOR_API_KEY",
            "ARK_API_KEY",
            "OPENAI_API_KEY",
        ),
        "base_url": _first_env(
            "DEEPTUTOR_BASE_URL",
            "ARK_BASE_URL",
            "OPENAI_BASE_URL",
        ),
        "model": _first_env(
            "DEEPTUTOR_MODEL",
            "ARK_MODEL",
            "ARK_ENDPOINT_ID",
            "OPENAI_MODEL",
        ),
    }
    missing = [name for name, value in config.items() if not value]
    if missing:
        raise BridgeError(
            "MISSING_LLM_CONFIGURATION",
            "Missing model configuration in process environment: "
            + ", ".join(missing),
        )
    return config


def _normalize_request(request: dict[str, Any]) -> dict[str, Any]:
    forbidden = {
        "api_key",
        "key",
        "token",
        "authorization",
        "password",
        "secret",
    }
    if any(str(key).lower() in forbidden for key in request):
        raise BridgeError(
            "SECRET_IN_REQUEST_FORBIDDEN",
            "Credentials must not be included in the JSON request",
        )
    source_text = request.get("source_text")
    if not isinstance(source_text, str):
        raise BridgeError("INVALID_INPUT", "source_text must be a string")
    source_text = source_text.strip()
    if not 20 <= len(source_text) <= 20_000:
        raise BridgeError(
            "INVALID_INPUT",
            "source_text must contain 20-20000 characters",
        )
    mode = request.get("llm_mode", "environment")
    if mode not in {"environment", "rpc"}:
        raise BridgeError(
            "INVALID_INPUT",
            "llm_mode must be environment or rpc",
        )
    if mode == "rpc" and _rpc_secret_environment_present():
        raise BridgeError(
            "RPC_SECRET_ENV_LEAK",
            "RPC mode refuses to start with credential-like environment variables",
        )
    title = request.get("title", "")
    if not isinstance(title, str):
        raise BridgeError("INVALID_INPUT", "title must be a string")
    title = title.strip() or _infer_title(source_text)
    language = request.get("language", "")
    if not isinstance(language, str):
        raise BridgeError("INVALID_INPUT", "language must be a string")
    language = "zh" if (language.lower().startswith("zh") or _has_cjk(source_text)) else "en"
    source_id = request.get("source_id", "")
    if not isinstance(source_id, str):
        raise BridgeError("INVALID_INPUT", "source_id must be a string")
    estimated = request.get("estimated_chapters")
    if estimated is None:
        # A short paragraph should not be stretched into a four-chapter book.
        # Keep the official proposal control, but size it to the supplied
        # source so the downstream compiler stays useful and bounded.
        estimated = max(2, min(6, (len(source_text) + 599) // 600))
    if not isinstance(estimated, int) or not 2 <= estimated <= 8:
        raise BridgeError(
            "INVALID_INPUT",
            "estimated_chapters must be an integer from 2 to 8",
        )
    return {
        "source_text": source_text,
        "title": title[:160],
        "language": language,
        "source_id": source_id.strip()[:200] or "stdin",
        "estimated_chapters": estimated,
        "llm_mode": mode,
    }


def _rpc_secret_environment_present() -> bool:
    sensitive_fragments = (
        "API_KEY",
        "APIKEY",
        "AUTHORIZATION",
        "ACCESS_TOKEN",
        "AUTH_TOKEN",
        "PASSWORD",
        "CLIENT_SECRET",
    )
    return any(
        value and any(fragment in name.upper() for fragment in sensitive_fragments)
        for name, value in os.environ.items()
    )


def _infer_title(source_text: str) -> str:
    first = source_text.splitlines()[0].lstrip("#").strip()
    for separator in ("：", ":", "。", ".", "！", "!", "？", "?"):
        first = first.split(separator, 1)[0].strip()
    return (first or "知识点素材")[:80]


def _has_cjk(value: str) -> bool:
    return any("\u3400" <= character <= "\u9fff" for character in value)


def _book_id(source_text: str) -> str:
    digest = hashlib.sha256(source_text.encode("utf-8")).hexdigest()[:16]
    return f"bridge_{digest}"


def _build_context(request: dict[str, Any]) -> tuple[Book, BookProposal, ExplorationReport]:
    book_id = _book_id(request["source_text"])
    description = request["source_text"][:600]
    proposal = BookProposal(
        title=request["title"],
        description=description,
        scope="Only the supplied source document",
        target_level="adaptive",
        estimated_chapters=request["estimated_chapters"],
        rationale="Build an evidence-grounded learning spine from the supplied source.",
    )
    chunk = SourceChunk(
        chunk_id="stdin_source_1",
        source="manual",
        ref=request["source_id"],
        text=request["source_text"],
        score=1.0,
        query=request["title"],
        metadata={"bridge": "stdin"},
    )
    exploration = ExplorationReport(
        book_id=book_id,
        queries=[request["title"]],
        chunks=[chunk],
        summary=request["source_text"][:1000],
        coverage={"manual": 1},
        candidate_concepts=[],
        notes=["Source supplied directly to the native DeepTutor bridge."],
    )
    book = Book(
        id=book_id,
        title=request["title"],
        description=description,
        status=BookStatus.SPINE_READY,
        proposal=proposal,
        language=request["language"],
    )
    return book, proposal, exploration


def _create_synthesizer(
    request: dict[str, Any],
    gateway: RpcModelGateway | None,
) -> SpineSynthesizer:
    if request["llm_mode"] == "rpc":
        if gateway is None:
            raise BridgeError(
                "INVALID_RPC_CONFIGURATION",
                "RPC mode requires a model gateway",
            )
        return RpcSpineSynthesizer(
            gateway,
            language=request["language"],
            max_rounds=2,
        )
    config = _environment_config()
    synthesizer = SpineSynthesizer(
        api_key=config["api_key"],
        base_url=config["base_url"],
        binding="openai",
        language=request["language"],
        max_rounds=2,
    )
    # The pinned SpineSynthesizer constructor does not expose BaseAgent's
    # ``model`` parameter; assign the environment-selected model on the
    # instance before the upstream stream_llm path reads it.
    synthesizer.model = config["model"]
    return synthesizer


SECTION_OUTLINE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["intro", "subsections", "key_takeaway"],
    "properties": {
        "intro": {"type": "string"},
        "subsections": {
            "type": "array",
            "minItems": 2,
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["heading", "role", "focus", "target_words"],
                "properties": {
                    "heading": {"type": "string"},
                    "role": {"type": "string"},
                    "focus": {"type": "string"},
                    "target_words": {
                        "type": "integer",
                        "minimum": 160,
                        "maximum": 520,
                    },
                },
            },
        },
        "key_takeaway": {"type": "string"},
    },
}


def _install_rpc_section_transport(gateway: RpcModelGateway) -> None:
    """Route the official SectionGenerator prompts through the host model."""

    from deeptutor.book.blocks import section as section_module
    from deeptutor.services.prompt.language import append_language_directive

    async def rpc_section_outline(**kwargs: Any) -> dict[str, Any]:
        system_prompt = str(kwargs.get("system_prompt") or "")
        language = kwargs.get("language")
        if language:
            system_prompt = append_language_directive(system_prompt, str(language))
        return await gateway.call_json(
            system_prompt=system_prompt,
            user_prompt=str(kwargs.get("user_prompt") or ""),
            stage="section_outline",
            schema=SECTION_OUTLINE_SCHEMA,
            max_tokens=int(kwargs.get("max_tokens") or 900),
            temperature=float(kwargs.get("temperature") or 0.4),
        )

    async def rpc_section_text(**kwargs: Any) -> str:
        system_prompt = str(kwargs.get("system_prompt") or "")
        language = kwargs.get("language")
        if language:
            system_prompt = append_language_directive(system_prompt, str(language))
        return await gateway.call_text(
            system_prompt=system_prompt,
            user_prompt=str(kwargs.get("user_prompt") or ""),
            stage="section_subsection",
            max_tokens=int(kwargs.get("max_tokens") or 1200),
            temperature=float(kwargs.get("temperature") or 0.5),
        )

    # These are the two model seams imported by the pinned upstream
    # SectionGenerator. The planner, prompts, evidence selection, two-pass
    # orchestration, validation, and native payload assembly remain upstream.
    section_module.llm_json = rpc_section_outline
    section_module.llm_text = rpc_section_text


class SilentBookStream:
    _EVENTS = {
        "page_compile_started": (
            "started",
            "DeepTutor 开始编译页面",
        ),
        "page_planning": (
            "started",
            "DeepTutor 开始规划页面",
        ),
        "page_planned": (
            "completed",
            "DeepTutor 页面规划已完成",
        ),
        "block_started": (
            "started",
            "DeepTutor 开始生成内容块",
        ),
        "block_ready": (
            "completed",
            "DeepTutor 内容块已就绪",
        ),
        "block_error": (
            "failed",
            "DeepTutor 内容块生成失败",
        ),
        "page_compiled": (
            "completed",
            "DeepTutor 页面编译已完成",
        ),
    }
    _STAGES = {
        "compilation": "compilation",
        "page_plan": "page_plan",
        "block": "block",
    }

    async def book_event(
        self,
        kind: str,
        data: dict[str, Any],
        stage: str = "",
    ) -> None:
        event_definition = self._EVENTS.get(kind)
        if event_definition is None:
            return
        status, title = event_definition
        safe_data = data if isinstance(data, dict) else {}
        meta: dict[str, Any] = {
            "kind": kind,
            "upstream_stage": self._STAGES.get(stage, "book"),
        }
        for key in (
            "page_id",
            "chapter_id",
            "block_id",
            "block_type",
        ):
            safe_value = _safe_trace_token(safe_data.get(key))
            if safe_value:
                meta[key] = safe_value

        blocks = safe_data.get("blocks")
        if isinstance(blocks, list):
            meta["block_count"] = len(blocks)
            meta["ready_block_count"] = sum(
                1
                for block in blocks
                if isinstance(block, dict) and block.get("status") == "ready"
            )
        payload_keys = safe_data.get("payload_keys")
        if isinstance(payload_keys, list):
            meta["payload_keys"] = [
                key
                for key in (
                    _safe_trace_token(value)
                    for value in payload_keys
                )
                if key
            ][:20]
        if kind == "block_error":
            meta["error_code"] = "UPSTREAM_BLOCK_ERROR"

        call_id = (
            _safe_trace_token(safe_data.get("block_id"))
            or _safe_trace_token(safe_data.get("page_id"))
        )
        trace_stage = self._STAGES.get(stage, "book")
        _emit_trace(
            event_type="book.event",
            stage=f"deeptutor.book.{trace_stage}",
            status=status,
            title=title,
            call_id=call_id,
            meta=meta,
        )


def _section_is_substantive(page: Page) -> bool:
    for block in page.blocks:
        if block.type != BlockType.SECTION or block.status != BlockStatus.READY:
            continue
        subsections = block.payload.get("subsections")
        if not isinstance(subsections, list) or not subsections:
            continue
        bodies = [
            str(item.get("body") or "").strip()
            for item in subsections
            if isinstance(item, dict)
        ]
        if bodies and all(
            len(body) >= 16 and "generation failed:" not in body.lower()
            for body in bodies
        ):
            return True
    return False


async def _compile_primary_sections(
    *,
    request: dict[str, Any],
    storage: MemoryBookStorage,
    spine: Spine,
    pages: list[Page],
    exploration: ExplorationReport,
    gateway: RpcModelGateway | None,
) -> dict[str, Any]:
    """Compile one official long-form SECTION block for every regular page.

    DeepTutor's optional quiz, visualisation, interactive, and animation
    generators use separate agent stacks or native rendering toolchains. The
    bridge deliberately keeps those outside this host-only compatibility
    profile rather than returning ERROR blocks or pretending they ran.
    """

    if gateway is not None:
        _install_rpc_section_transport(gateway)

    planner = PagePlanner(phase=2)
    compiler = BookCompiler(
        storage=storage,
        options=CompilerOptions(
            phase=2,
            rag_enabled=False,
            block_concurrency=1,
            persist_after_each_block=True,
            architect_llm_enabled=False,
        ),
    )
    stream = SilentBookStream()
    compiled_pages = 0
    ready_blocks = 0
    skipped_optional_types: set[str] = set()
    compile_targets = [
        (page, chapter)
        for page in pages
        if (
            (chapter := spine.chapter_by_id(page.chapter_id)) is not None
            and page.content_type.value != "overview"
        )
    ]

    for page_index, (page, chapter) in enumerate(compile_targets, start=1):
        page_meta = {
            "page_id": page.id,
            "chapter_id": chapter.id,
            "page_index": page_index,
            "page_count": len(compile_targets),
        }
        _emit_trace(
            event_type="page.compile",
            stage="deeptutor.compilation.page",
            status="started",
            title="开始编译 DeepTutor 章节页面",
            call_id=page.id,
            meta=page_meta,
        )
        try:
            planned = planner.plan_blocks(chapter)
            primary_section = next(
                (block for block in planned if block.type == BlockType.SECTION),
                None,
            )
            if primary_section is None:
                raise BridgeError(
                    "UPSTREAM_PAGE_PLAN_FAILED",
                    "DeepTutor PagePlanner returned no primary section block",
                )
            skipped_optional_types.update(
                block.type.value
                for block in planned
                if block.id != primary_section.id
            )

            page.blocks = [primary_section]
            page.status = PageStatus.PENDING
            page.error = ""
            storage.save_page(page)
            compiled = await compiler.compile_page(
                book_id=page.book_id,
                chapter=chapter,
                page=page,
                stream=stream,
                knowledge_bases=[],
                language=request["language"],
                exploration=exploration,
            )
            if (
                compiled.status != PageStatus.READY
                or not _section_is_substantive(compiled)
            ):
                raise BridgeError(
                    "UPSTREAM_COMPILATION_INCOMPLETE",
                    "DeepTutor did not produce a substantive ready section",
                )
        except Exception as exc:
            _emit_trace(
                event_type="page.compile",
                stage="deeptutor.compilation.page",
                status="failed",
                title="DeepTutor 章节页面编译失败",
                call_id=page.id,
                meta={
                    **page_meta,
                    "error_code": (
                        exc.code
                        if isinstance(exc, BridgeError)
                        else "UPSTREAM_PAGE_COMPILE_FAILED"
                    ),
                },
            )
            raise

        page_ready_blocks = sum(
            1 for block in compiled.blocks if block.status == BlockStatus.READY
        )
        compiled_pages += 1
        ready_blocks += page_ready_blocks
        _emit_trace(
            event_type="page.compile",
            stage="deeptutor.compilation.page",
            status="completed",
            title="DeepTutor 章节页面编译完成",
            call_id=page.id,
            meta={
                **page_meta,
                "block_count": len(compiled.blocks),
                "ready_block_count": page_ready_blocks,
            },
        )

    return {
        "profile": "official_primary_section",
        "compiled_pages": compiled_pages,
        "ready_blocks": ready_blocks,
        "skipped_optional_block_types": sorted(skipped_optional_types),
        "limitations": [
            "The host bridge compiles the first official SECTION planned for each chapter.",
            "Quiz, figure, interactive, animation, and other optional generators are not executed.",
        ],
    }


async def _run_native(request: dict[str, Any]) -> dict[str, Any]:
    book, proposal, exploration = _build_context(request)
    gateway = (
        RpcModelGateway(sys.stdin, PROTOCOL_OUT)
        if request["llm_mode"] == "rpc"
        else None
    )
    synthesizer = _create_synthesizer(request, gateway)
    rounds: list[dict[str, Any]] = []
    round_payloads: dict[str, dict[str, Any]] = {}

    def record_round(
        label: str,
        payload: dict[str, Any],
        *,
        issue_count_override: int | None = None,
        verdict_override: str = "",
    ) -> None:
        chapter_count = (
            len(payload.get("chapters") or [])
            if isinstance(payload, dict)
            else 0
        )
        issue_count = (
            issue_count_override
            if issue_count_override is not None
            else (
                len(payload.get("issues") or [])
                if isinstance(payload, dict)
                else 0
            )
        )
        verdict = (
            verdict_override
            or (
                payload.get("verdict", "")
                if isinstance(payload, dict)
                else ""
            )
        )
        round_info = {
            "label": label,
            "chapter_count": chapter_count,
            "issue_count": issue_count,
            "verdict": verdict,
        }
        rounds.append(round_info)
        safe_label = _safe_trace_token(label) or "round"
        if label == "draft":
            title = "DeepTutor 知识结构初稿已生成"
        elif label.startswith("critique"):
            title = "DeepTutor 知识结构评审已完成"
        elif label.startswith("revise"):
            title = "DeepTutor 知识结构修订已完成"
        else:
            title = "DeepTutor 知识结构轮次已完成"
        _emit_trace(
            event_type="spine.round",
            stage=f"deeptutor.synthesis.{safe_label}",
            status="completed",
            title=title,
            meta={
                "round_label": label,
                "chapter_count": chapter_count,
                "issue_count": issue_count,
                "verdict": verdict,
            },
        )

    async def on_round(label: str, payload: dict[str, Any]) -> None:
        if isinstance(payload, dict):
            round_payloads[label] = payload
        record_round(label, payload)

    _emit_trace(
        event_type="phase.start",
        stage="deeptutor.synthesis",
        status="started",
        title="开始运行 DeepTutor 知识结构合成",
    )
    try:
        spine = await synthesizer.synthesize(
            book_id=book.id,
            proposal=proposal,
            exploration=exploration,
            on_round=on_round,
        )
    except Exception as exc:
        _emit_trace(
            event_type="phase.error",
            stage="deeptutor.synthesis",
            status="failed",
            title="DeepTutor 知识结构合成失败",
            meta={
                "error_code": (
                    exc.code
                    if isinstance(exc, BridgeError)
                    else "UPSTREAM_SYNTHESIS_FAILED"
                )
            },
        )
        raise
    labels = [round_info["label"] for round_info in rounds]
    if "draft" not in labels or "critique_1" not in labels:
        raise BridgeError(
            "UPSTREAM_SYNTHESIS_FAILED",
            "DeepTutor did not complete the required draft and critique stages",
        )

    # Upstream skips revise when critique returns "ok". The product contract
    # explicitly requires Draft → Critique → Revise, so run the upstream revise
    # method once more in that case and materialise its native payload.
    if not any(label.startswith("revise_") for label in labels):
        proposal_block = synthesizer._render_proposal(proposal)
        draft = round_payloads.get("draft")
        critique = round_payloads.get("critique_1")
        if not isinstance(draft, dict) or not draft:
            raise BridgeError(
                "UPSTREAM_DRAFT_FAILED",
                "DeepTutor draft stage returned no structured payload",
            )
        forced_critique = {
            "issues": [
                {
                    "category": "other",
                    "detail": "Run the required final source-grounding and duplicate-concept audit.",
                    "fix_hint": "Preserve valid structure while removing unsupported or duplicate concepts.",
                }
            ],
            "verdict": "revise",
            "prior_critique": critique if isinstance(critique, dict) else {},
        }
        revised = await synthesizer._revise(
            proposal_block=proposal_block,
            draft=draft,
            critique=forced_critique,
        )
        if not isinstance(revised, dict) or not revised:
            raise BridgeError(
                "UPSTREAM_REVISE_FAILED",
                "DeepTutor revise stage returned no structured payload",
            )
        spine = synthesizer._materialise(
            book_id=book.id,
            proposal=proposal,
            payload=revised,
            exploration=exploration,
        )
        record_round(
            "revise_required",
            revised,
            issue_count_override=1,
            verdict_override="revise",
        )

    _emit_trace(
        event_type="phase.complete",
        stage="deeptutor.synthesis",
        status="completed",
        title="DeepTutor 知识结构合成完成",
        meta={
            "chapter_count": len(spine.chapters),
            "round_label": rounds[-1]["label"] if rounds else "",
        },
    )
    storage = MemoryBookStorage()
    book.chapter_count = len(spine.chapters)
    storage.save_book(book)
    storage.save_spine(spine)
    engine = BookEngine(storage=storage)
    _emit_trace(
        event_type="phase.start",
        stage="deeptutor.confirm_spine",
        status="started",
        title="开始确认 DeepTutor 知识脊柱",
    )
    try:
        pages = await engine.confirm_spine(
            book_id=book.id,
            edited_spine=spine,
            stream=None,
            auto_compile=False,
        )
    except Exception as exc:
        _emit_trace(
            event_type="phase.error",
            stage="deeptutor.confirm_spine",
            status="failed",
            title="DeepTutor 知识脊柱确认失败",
            meta={
                "error_code": (
                    exc.code
                    if isinstance(exc, BridgeError)
                    else "UPSTREAM_CONFIRM_SPINE_FAILED"
                )
            },
        )
        raise
    _emit_trace(
        event_type="phase.complete",
        stage="deeptutor.confirm_spine",
        status="completed",
        title="DeepTutor 知识脊柱确认完成",
        meta={
            "chapter_count": len(spine.chapters),
            "page_count": len(pages),
        },
    )

    _emit_trace(
        event_type="phase.start",
        stage="deeptutor.compilation",
        status="started",
        title="开始运行 DeepTutor 页面编译",
        meta={"page_count": len(pages)},
    )
    try:
        compilation = await _compile_primary_sections(
            request=request,
            storage=storage,
            spine=spine,
            pages=pages,
            exploration=exploration,
            gateway=gateway,
        )
    except Exception as exc:
        _emit_trace(
            event_type="phase.error",
            stage="deeptutor.compilation",
            status="failed",
            title="DeepTutor 页面编译失败",
            meta={
                "error_code": (
                    exc.code
                    if isinstance(exc, BridgeError)
                    else "UPSTREAM_COMPILATION_FAILED"
                )
            },
        )
        raise
    _emit_trace(
        event_type="phase.complete",
        stage="deeptutor.compilation",
        status="completed",
        title="DeepTutor 页面编译完成",
        meta={
            "page_count": compilation["compiled_pages"],
            "block_count": compilation["ready_blocks"],
        },
    )
    book.status = BookStatus.READY
    storage.save_book(book)

    final_book = storage.load_book(book.id) or book
    final_spine = storage.load_spine(book.id) or spine
    final_pages = storage.list_pages(book.id)
    return {
        "ok": True,
        "type": "result",
        "bridge_version": "1.1.0",
        "provenance": {
            "upstream_repo": "https://github.com/HKUDS/DeepTutor",
            "tag": PINNED_TAG,
            "source_revision": PINNED_COMMIT,
            "license": "Apache-2.0",
            "native": True,
            "source_files": [
                "deeptutor/book/agents/spine_synthesizer.py",
                "deeptutor/book/engine.py",
                "deeptutor/book/compiler.py",
                "deeptutor/book/agents/page_planner.py",
                "deeptutor/book/blocks/section.py",
                "deeptutor/book/blocks/_llm_writer.py",
                "deeptutor/book/blocks/concept_graph.py",
                "deeptutor/book/models.py",
            ],
        },
        "execution": {
            "mode": request["llm_mode"],
            "model_used": True,
            "rounds": rounds,
            "compilation": compilation,
            "upstream_symbols": [
                "SpineSynthesizer.synthesize",
                "SpineSynthesizer._draft",
                "SpineSynthesizer._critique",
                "SpineSynthesizer._revise",
                "SpineSynthesizer._materialise",
                "_build_chapter_map",
                "BookEngine.confirm_spine",
                "BookEngine._ensure_overview_chapter",
                "BookEngine._materialize_overview_page",
                "PagePlanner.plan_blocks",
                "BookCompiler.compile_page",
                "SectionGenerator._make_outline",
                "SectionGenerator._fill_subsection",
                "render_mermaid",
            ],
            "module_origins": {
                "spine_synthesizer": str(
                    Path(sys.modules[SpineSynthesizer.__module__].__file__).resolve()
                ),
                "book_engine": str(
                    Path(sys.modules[BookEngine.__module__].__file__).resolve()
                ),
                "book_compiler": str(
                    Path(sys.modules[BookCompiler.__module__].__file__).resolve()
                ),
                "section_generator": str(
                    Path(
                        sys.modules["deeptutor.book.blocks.section"].__file__
                    ).resolve()
                ),
            },
        },
        "native_result": {
            "book": final_book.model_dump(mode="json"),
            "exploration": exploration.model_dump(mode="json"),
            "spine": final_spine.model_dump(mode="json"),
            "pages": [
                page.model_dump(mode="json")
                for page in final_pages
            ],
        },
    }


def main() -> int:
    try:
        request = _normalize_request(_read_json_line(sys.stdin))
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(_run_native(request))
        _write_json(result)
        return 0
    except BridgeError as exc:
        _write_json(
            {
                "ok": False,
                "type": "error",
                "error": {"code": exc.code, "message": str(exc)},
            }
        )
        return 2
    except Exception as exc:
        if os.environ.get("DEEPTUTOR_BRIDGE_DEBUG") == "1":
            frames = [
                {
                    "file": str(Path(frame.filename).name),
                    "line": frame.lineno,
                    "function": frame.name,
                }
                for frame in traceback.extract_tb(exc.__traceback__)
            ]
            sys.stderr.write(
                json.dumps(
                    {"exception_type": type(exc).__name__, "frames": frames},
                    ensure_ascii=False,
                )
                + "\n"
            )
        # Never copy arbitrary exception strings: provider/library errors may
        # include request headers or other sensitive details.
        _write_json(
            {
                "ok": False,
                "type": "error",
                "error": {
                    "code": "DEEPTUTOR_BRIDGE_FAILED",
                    "message": "The native DeepTutor bridge failed",
                },
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
