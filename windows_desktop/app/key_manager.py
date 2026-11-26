import time
from typing import Callable, List, Tuple, TypeVar
from app.database import LocalDatabase

T = TypeVar("T")


class ApiKeyRotationManager:
    def __init__(self, db: LocalDatabase):
        self.db = db
        self._cursors = {"gemini": 0, "groq": 0}

    def _ready_keys(self, provider: str) -> List[Tuple[str, str, str]]:
        now = time.time()
        rows = self.db.list_api_keys(provider)
        ready = []
        for r in rows:
            if not r["is_enabled"]:
                continue
            if r["status"] in ("invalid", "disabled"):
                continue
            if r["status"] == "rate_limited" and r["cooldown_until"] and r["cooldown_until"] > now:
                continue
            raw = self.db.get_decrypted_key(r["id"])
            if raw:
                ready.append((r["id"], r["label"], raw))

        if not ready:
            return []
        start = self._cursors[provider] % len(ready)
        self._cursors[provider] = (start + 1) % len(ready)
        return ready[start:] + ready[:start]

    @staticmethod
    def _classify_error(exc: Exception) -> str:
        msg = str(exc).lower()
        if any(tok in msg for tok in ("429", "rate limit", "rate_limit", "quota", "resource_exhausted")):
            return "rate_limited"
        if any(tok in msg for tok in ("401", "403", "api_key_invalid", "invalid api key", "unauthorized", "permission_denied")):
            return "invalid"
        return "transient"

    def execute_with_rotation(self, provider: str, fn: Callable[[str], T]) -> T:
        candidates = self._ready_keys(provider)
        if not candidates:
            raise RuntimeError(
                f"No active {provider.upper()} API key available. Please add and enable a valid {provider.upper()} API key in the API Key Manager."
            )
        last_exc: Exception | None = None
        for key_id, _label, raw_key in candidates:
            try:
                res = fn(raw_key)
                self.db.record_key_usage(key_id)
                return res
            except Exception as exc:
                last_exc = exc
                kind = self._classify_error(exc)
                if kind == "rate_limited":
                    self.db.record_key_error(key_id, "rate_limited", str(exc), time.time() + 60.0)
                    continue
                if kind == "invalid":
                    self.db.record_key_error(key_id, "invalid", str(exc), None)
                    continue
                time.sleep(0.8)
                try:
                    res = fn(raw_key)
                    self.db.record_key_usage(key_id)
                    return res
                except Exception as retry_exc:
                    last_exc = retry_exc
                    continue
        assert last_exc is not None
        raise last_exc
