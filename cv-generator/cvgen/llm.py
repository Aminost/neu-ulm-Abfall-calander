"""Thin wrapper around the Anthropic SDK for structured (Pydantic) outputs."""

from __future__ import annotations

import os
from typing import Type, TypeVar

import anthropic
from pydantic import BaseModel

DEFAULT_MODEL = os.environ.get("CVGEN_MODEL", "claude-opus-5-5")

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


def make_client(api_key: str | None = None) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()


def structured_call(
    *,
    system: str,
    content: str | list,
    output_model: Type[T],
    model: str | None = None,
    effort: str = "high",
    max_tokens: int = 64000,
    client: anthropic.Anthropic | None = None,
) -> T:
    """Send one request and return a validated ``output_model`` instance.

    Streams the response (large outputs would otherwise hit HTTP timeouts) and enables
    Anthropic's server-side fallback, so a request declined by a safety classifier is
    re-run on a recommended fallback model instead of failing.
    """
    client = client or make_client()
    try:
        with client.messages.stream(
            model=model or DEFAULT_MODEL,
            max_tokens=max_tokens,
            system=system,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            messages=[{"role": "user", "content": content}],
            output_format=output_model,
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        ) as stream:
            response = stream.get_final_message()
    except anthropic.AuthenticationError as exc:
        raise LLMError("Anthropic API key missing or invalid. Add it under Settings.") from exc
    except anthropic.RateLimitError as exc:
        raise LLMError("Rate limited by the Anthropic API - try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        raise LLMError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMError(f"Could not reach the Anthropic API: {exc}") from exc

    if response.stop_reason == "refusal":
        raise LLMError("The model declined this request.")
    if response.stop_reason == "max_tokens":
        raise LLMError("The model ran out of output tokens.")
    parsed = getattr(response, "parsed_output", None)
    if parsed is None:
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        try:
            parsed = output_model.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise LLMError("The model did not return valid structured output.") from exc
    return parsed
