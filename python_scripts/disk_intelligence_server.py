#!/usr/bin/env python3
"""Local Disk Intelligence Server (FastAPI).

Production-grade local service for disk analysis and safe cleanup.
- REST + WebSocket progress updates
- Background worker jobs for heavy operations
- SQLite snapshot persistence
- Risk-scored cleanup with dry-run default

Default host is 127.0.0.1 (localhost-only).
For LAN testing from phone on same network, run with --host 0.0.0.0 intentionally.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import socket
import tempfile
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

try:
    from python_scripts.disk_intelligence_engine import (
        APP_NAME,
        CRITICAL_DELETE_PATHS,
        DEFAULT_DB,
        DEFAULT_LOG_FILE,
        DEFAULT_QUARANTINE_DIR,
        DEFAULT_SKIP_PREFIXES,
        CleanupEngine,
        CleanupPolicy,
        DiskAnalyzer,
        DuplicateDetector,
        Engine,
        FileClassifier,
        RiskScorer,
        SnapshotStore,
        human_bytes,
        now_utc_iso,
        parse_size_to_bytes,
    )
except ModuleNotFoundError:
    from disk_intelligence_engine import (
        APP_NAME,
        CRITICAL_DELETE_PATHS,
        DEFAULT_DB,
        DEFAULT_LOG_FILE,
        DEFAULT_QUARANTINE_DIR,
        DEFAULT_SKIP_PREFIXES,
        CleanupEngine,
        CleanupPolicy,
        DiskAnalyzer,
        DuplicateDetector,
        Engine,
        FileClassifier,
        RiskScorer,
        SnapshotStore,
        human_bytes,
        now_utc_iso,
        parse_size_to_bytes,
    )


# ------------------------------- Logging ------------------------------------ #


def configure_logging(log_file: Path) -> logging.Logger:
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        log_file = Path(tempfile.gettempdir()) / "disk_intel" / "server.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("disk_intel_server")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(formatter)
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    logger.addHandler(sh)
    return logger


LOGGER = configure_logging(Path(tempfile.gettempdir()) / "disk_intel" / "server.log")
APP_LOOP: asyncio.AbstractEventLoop | None = None
CONNECT_URL = os.getenv("DISK_INTEL_CONNECT_URL", "")
STARTUP_BANNER_PRINTED = False


# ---------------------------- API Models ------------------------------------ #


class ScanRequest(BaseModel):
    roots: list[str] = Field(default_factory=lambda: [str(Path.cwd())])
    follow_symlinks: bool = False
    include_hidden: bool = True


class AnalyzeRequest(BaseModel):
    snapshot_id: int | None = None
    top_n: int = 50
    include_duplicates: bool = True


class DuplicateRequest(BaseModel):
    snapshot_id: int | None = None


class LargeOldFilterRequest(BaseModel):
    snapshot_id: int | None = None
    min_size: str = "500MB"
    older_than_days: int = 180
    limit: int = 1000


class CleanupRequest(BaseModel):
    snapshot_id: int | None = None
    mode: str = Field(default="large-old", pattern="^(duplicates|large-old|logs-temp|paths)$")
    roots: list[str] = Field(default_factory=lambda: [str(Path.cwd())])
    min_size: str = "1GB"
    older_than_days: int = 180
    limit: int = 2000
    paths: list[str] = Field(default_factory=list)
    execute: bool = False
    force_high_risk: bool = False
    quarantine_mode: bool = True
    confirm: bool = False


class UndoRequest(BaseModel):
    action_id: str


class CleanupActionRequest(BaseModel):
    snapshot_id: int | None = None
    roots: list[str] = Field(default_factory=lambda: [str(Path.cwd())])
    min_size: str = "500MB"
    older_than_days: int = 180
    limit: int = 2000
    force_high_risk: bool = False
    quarantine_mode: bool = True
    confirm: bool = False


# ---------------------------- Response Helpers ------------------------------ #


def api_ok(data: Any, *, meta: dict[str, Any] | None = None, warnings: list[str] | None = None) -> JSONResponse:
    body = {
        "status": "ok",
        "timestamp": now_utc_iso(),
        "meta": meta or {},
        "warnings": warnings or [],
        "data": data,
    }
    return JSONResponse(body)


def api_error(code: str, message: str, status_code: int = 400, details: dict[str, Any] | None = None) -> JSONResponse:
    body = {
        "status": "error",
        "timestamp": now_utc_iso(),
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }
    return JSONResponse(body, status_code=status_code)


# -------------------------- Basic Rate Limiter ------------------------------ #


class BasicRateLimiter:
    """In-memory fixed-window limiter for safety on local service."""

    def __init__(self, max_requests: int = 120, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            arr = self._hits.setdefault(key, [])
            threshold = now - self.window_seconds
            while arr and arr[0] < threshold:
                arr.pop(0)
            if len(arr) >= self.max_requests:
                return False
            arr.append(now)
            return True


RATE_LIMITER = BasicRateLimiter()


# ------------------------------- Job Manager -------------------------------- #


@dataclass
class JobState:
    job_id: str
    job_type: str
    status: str = "queued"
    created_at: str = field(default_factory=now_utc_iso)
    updated_at: str = field(default_factory=now_utc_iso)
    progress: dict[str, Any] = field(default_factory=lambda: {"phase": "queued", "pct": 0.0})
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class JobManager:
    def __init__(self, max_workers: int = 4):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self._jobs: dict[str, JobState] = {}
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._lock = threading.Lock()

    def create_job(self, job_type: str) -> JobState:
        job = JobState(job_id=uuid.uuid4().hex, job_type=job_type)
        with self._lock:
            self._jobs[job.job_id] = job
            self._subs[job.job_id] = set()
        return job

    def get(self, job_id: str) -> JobState | None:
        with self._lock:
            return self._jobs.get(job_id)

    def subscribe(self, job_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        with self._lock:
            if job_id not in self._subs:
                self._subs[job_id] = set()
            self._subs[job_id].add(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            if job_id in self._subs:
                self._subs[job_id].discard(q)

    def _notify(self, job_id: str, payload: dict[str, Any]) -> None:
        # Thread-safe enqueue for async subscribers
        with self._lock:
            queues = list(self._subs.get(job_id, set()))

        for q in queues:
            try:
                if APP_LOOP and APP_LOOP.is_running():
                    APP_LOOP.call_soon_threadsafe(_queue_put_nowait_safe, q, payload)
                else:
                    _queue_put_nowait_safe(q, payload)
            except Exception:
                continue

    def update_progress(self, job_id: str, progress: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.progress = progress
            job.updated_at = now_utc_iso()

        self._notify(job_id, {"event": "progress", "job_id": job_id, "progress": progress})

    def _set_status(self, job_id: str, status: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = status
            job.updated_at = now_utc_iso()

        self._notify(job_id, {"event": "status", "job_id": job_id, "status": status})

    def _set_result(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.result = result
            job.status = "completed"
            job.updated_at = now_utc_iso()

        self._notify(job_id, {"event": "completed", "job_id": job_id, "result": result})

    def _set_error(self, job_id: str, code: str, message: str, tb: str = "") -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.error = {"code": code, "message": message, "traceback": tb}
            job.status = "failed"
            job.updated_at = now_utc_iso()

        self._notify(job_id, {"event": "failed", "job_id": job_id, "error": {"code": code, "message": message}})

    def submit(self, job: JobState, func: Callable[[Callable[[dict[str, Any]], None]], dict[str, Any]]) -> None:
        self._set_status(job.job_id, "running")

        def runner() -> None:
            try:
                result = func(lambda p: self.update_progress(job.job_id, p))
                self._set_result(job.job_id, result)
            except Exception as exc:  # pylint: disable=broad-except
                self._set_error(job.job_id, "JOB_EXECUTION_ERROR", str(exc), traceback.format_exc())

        self.executor.submit(runner)


def _queue_put_nowait_safe(q: asyncio.Queue, payload: dict[str, Any]) -> None:
    try:
        q.put_nowait(payload)
    except asyncio.QueueFull:
        with contextlib.suppress(Exception):
            _ = q.get_nowait()
        with contextlib.suppress(Exception):
            q.put_nowait(payload)


JOBS = JobManager(max_workers=max(2, (os.cpu_count() or 4) // 2))


# ------------------------- Path & Safety Validators ------------------------- #


def normalize_paths(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        rp = os.path.realpath(os.path.expanduser(p))
        out.append(rp)
    return out


def ensure_safe_scan_roots(roots: list[str]) -> list[str]:
    safe_roots = []
    for r in normalize_paths(roots):
        if not os.path.isdir(r):
            raise ValueError(f"Root is not a directory: {r}")
        if r in CRITICAL_DELETE_PATHS:
            raise ValueError(f"Restricted root is not allowed for scanning: {r}")
        if any(r == p or r.startswith(p + os.sep) for p in DEFAULT_SKIP_PREFIXES):
            raise ValueError(f"Restricted system root is not allowed for scanning: {r}")
        safe_roots.append(r)
    return safe_roots


def ensure_safe_cleanup_roots(roots: list[str]) -> list[str]:
    safe_roots = []
    for r in normalize_paths(roots):
        if not os.path.isdir(r):
            raise ValueError(f"Cleanup root is not a directory: {r}")
        if r in CRITICAL_DELETE_PATHS:
            raise ValueError(f"Critical path cannot be cleanup root: {r}")
        safe_roots.append(r)
    return safe_roots


def is_under_any(path: str, roots: list[str]) -> bool:
    rp = os.path.realpath(path)
    return any(rp == root or rp.startswith(root + os.sep) for root in roots)


# ---------------------------- DB Engine Session ----------------------------- #


@contextmanager
def engine_session(db_path: Path, classifier_rules: str | None = None, log_file: Path | None = None):
    engine = Engine(db_path=db_path, classifier_rule_file=classifier_rules, log_file=log_file or LOG_FILE)
    try:
        yield engine
    finally:
        engine.close()


# ---------------------------- Progressive Scanner --------------------------- #


class ProgressiveScanner:
    """Incremental scanner with progress callbacks and batched DB inserts."""

    def __init__(
        self,
        store: SnapshotStore,
        classifier: FileClassifier,
        roots: list[str],
        follow_symlinks: bool,
        include_hidden: bool,
        progress_cb: Callable[[dict[str, Any]], None],
        batch_size: int = 2000,
    ):
        self.store = store
        self.classifier = classifier
        self.roots = roots
        self.follow_symlinks = follow_symlinks
        self.include_hidden = include_hidden
        self.progress_cb = progress_cb
        self.batch_size = batch_size

    def run(self) -> dict[str, Any]:
        started = time.perf_counter()
        snapshot_id = self.store.create_snapshot(self.roots)

        total_files = 0
        total_bytes = 0
        errors: list[dict[str, str]] = []
        batch: list[tuple[Any, ...]] = []
        dirs_visited = 0

        self.progress_cb({"phase": "initializing", "pct": 0.0, "files_scanned": 0, "bytes_scanned": 0})

        for root in self.roots:
            stack = [root]
            while stack:
                current = stack.pop()
                dirs_visited += 1

                try:
                    with os.scandir(current) as it:
                        for entry in it:
                            path = entry.path
                            name = entry.name

                            if any(path == p or path.startswith(p + os.sep) for p in DEFAULT_SKIP_PREFIXES):
                                continue

                            try:
                                is_dir = entry.is_dir(follow_symlinks=self.follow_symlinks)
                                is_file = entry.is_file(follow_symlinks=self.follow_symlinks)
                            except OSError as exc:
                                errors.append({"path": path, "error": str(exc)})
                                continue

                            if is_dir:
                                stack.append(path)
                                continue

                            if not is_file:
                                continue

                            if (not self.include_hidden) and name.startswith("."):
                                continue

                            try:
                                st = entry.stat(follow_symlinks=self.follow_symlinks)
                            except OSError as exc:
                                errors.append({"path": path, "error": str(exc)})
                                continue

                            ext = Path(name).suffix.lower()
                            cat = self.classifier.classify(path, ext)
                            top_dir = root

                            row = (
                                snapshot_id,
                                path,
                                os.path.dirname(path),
                                top_dir,
                                int(st.st_size),
                                ext,
                                float(st.st_mtime),
                                oct(st.st_mode & 0o777),
                                1 if name.startswith(".") else 0,
                                1 if entry.is_symlink() else 0,
                                cat,
                            )
                            batch.append(row)
                            total_files += 1
                            total_bytes += int(st.st_size)

                            if total_files % 500 == 0:
                                self.progress_cb(
                                    {
                                        "phase": "scanning",
                                        "pct": None,
                                        "files_scanned": total_files,
                                        "bytes_scanned": total_bytes,
                                        "current_path": path,
                                        "dirs_visited": dirs_visited,
                                    }
                                )

                            if len(batch) >= self.batch_size:
                                self.store.insert_file_batch(batch)
                                self.store.commit()
                                batch.clear()
                except OSError as exc:
                    errors.append({"path": current, "error": str(exc)})

        if batch:
            self.store.insert_file_batch(batch)
            self.store.commit()

        duration = time.perf_counter() - started
        self.store.finalize_snapshot(snapshot_id, total_files, total_bytes, duration)

        self.progress_cb({"phase": "completed", "pct": 100.0, "files_scanned": total_files, "bytes_scanned": total_bytes})
        return {
            "snapshot_id": snapshot_id,
            "roots": self.roots,
            "total_files": total_files,
            "total_bytes": total_bytes,
            "total_human": human_bytes(total_bytes),
            "duration_sec": round(duration, 3),
            "dirs_visited": dirs_visited,
            "errors_count": len(errors),
            "errors_sample": errors[:100],
        }


# ------------------------------- App Setup ---------------------------------- #


def resolve_writable_path(preferred: Path, fallback_name: str) -> Path:
    """Return preferred path when writable, otherwise fallback in /tmp."""
    try:
        preferred.parent.mkdir(parents=True, exist_ok=True)
        probe = preferred.parent / ".write_probe"
        probe.touch(exist_ok=True)
        probe.unlink(missing_ok=True)
        return preferred
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "disk_intel" / fallback_name
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return fallback


DB_PATH = resolve_writable_path(Path(os.getenv("DISK_INTEL_DB", str(DEFAULT_DB))), "disk_intel.db")
LOG_FILE = resolve_writable_path(Path(os.getenv("DISK_INTEL_LOG", str(DEFAULT_LOG_FILE))), "disk_intel.log")
QUARANTINE_DIR = resolve_writable_path(
    Path(os.getenv("DISK_INTEL_QUARANTINE_DIR", str(DEFAULT_QUARANTINE_DIR))) / ".keep",
    "quarantine/.keep",
).parent
CLASSIFIER_RULES = os.getenv("DISK_INTEL_CLASSIFIER_RULES")

app = FastAPI(
    title="Disk Intelligence Server",
    version="1.0.0",
    description="Local disk analysis and cleanup API (safety-first).",
)


@app.on_event("startup")
async def _on_startup():
    global APP_LOOP
    APP_LOOP = asyncio.get_running_loop()
    ensure_startup_connect_banner()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
        "*",  # local tooling / mobile dev convenience
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client = request.client.host if request.client else "unknown"
    if not RATE_LIMITER.allow(client):
        return api_error("RATE_LIMITED", "Too many requests; slow down.", status_code=429)
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    LOGGER.exception("Unhandled server error: %s", exc)
    return api_error("INTERNAL_SERVER_ERROR", str(exc), status_code=500)


# ---------------------------- Job Endpoints --------------------------------- #


@app.get("/api/v1/jobs/{job_id}", summary="Get job status/progress")
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return api_ok(asdict(job))


@app.get("/api/v1/jobs/{job_id}/result", summary="Get job result")
async def get_job_result(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in {"completed", "failed"}:
        return api_ok({"job_id": job_id, "status": job.status, "progress": job.progress})
    return api_ok({"job_id": job_id, "status": job.status, "result": job.result, "error": job.error})


@app.websocket("/api/v1/ws/jobs/{job_id}")
async def ws_job_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()
    job = JOBS.get(job_id)
    if not job:
        await websocket.send_json({"status": "error", "message": "job not found"})
        await websocket.close()
        return

    q = JOBS.subscribe(job_id)
    try:
        await websocket.send_json({"event": "connected", "job_id": job_id})
        await websocket.send_json({"event": "snapshot", "job": asdict(job)})

        while True:
            payload = await q.get()
            await websocket.send_json(payload)
            current = JOBS.get(job_id)
            if current and current.status in {"completed", "failed"}:
                break
    except WebSocketDisconnect:
        pass
    finally:
        JOBS.unsubscribe(job_id, q)
        with contextlib.suppress(Exception):
            await websocket.close()


# ------------------------------- Scan APIs ---------------------------------- #


@app.post("/api/v1/analysis/scans/start", summary="Start a recursive scan", response_description="Job ID for tracking")
async def start_scan(req: ScanRequest):
    roots = ensure_safe_scan_roots(req.roots)
    job = JOBS.create_job("scan")

    def runner(progress_cb: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
            scanner = ProgressiveScanner(
                store=eng.store,
                classifier=eng.classifier,
                roots=roots,
                follow_symlinks=req.follow_symlinks,
                include_hidden=req.include_hidden,
                progress_cb=progress_cb,
            )
            result = scanner.run()
            LOGGER.info("scan completed job=%s snapshot=%s files=%s", job.job_id, result["snapshot_id"], result["total_files"])
            return result

    JOBS.submit(job, runner)
    return api_ok({"job_id": job.job_id, "status": job.status}, meta={"type": "scan"})


@app.get("/api/v1/analysis/scans/latest", summary="Get latest snapshot summary")
async def latest_scan_summary():
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        sid = eng.store.latest_snapshot()
        if sid is None:
            return api_ok({"has_snapshot": False})
        analyzer = DiskAnalyzer(eng.store, sid)
        return api_ok({"has_snapshot": True, "snapshot": analyzer.summary()})


# ----------------------------- Analysis APIs -------------------------------- #


def resolve_snapshot_id(eng: Engine, snapshot_id: int | None) -> int:
    sid = eng.get_snapshot_id(snapshot_id)
    return sid


@app.post("/api/v1/analysis/run", summary="Run full analysis on snapshot")
async def run_analysis(req: AnalyzeRequest):
    job = JOBS.create_job("analysis")

    def runner(progress_cb: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
            sid = resolve_snapshot_id(eng, req.snapshot_id)
            progress_cb({"phase": "analysis", "pct": 10.0, "snapshot_id": sid})
            analyzer = DiskAnalyzer(eng.store, sid)
            report = eng.analyze_snapshot(sid, top_n=req.top_n, include_duplicates=req.include_duplicates)
            progress_cb({"phase": "analysis", "pct": 55.0, "snapshot_id": sid})

            # Return a richer default payload so clients can render a complete analysis view
            # without chaining many additional API calls.
            full_bundle = {
                "snapshot_id": sid,
                "summary": analyzer.summary(),
                "largest_files": analyzer.largest_files(limit=req.top_n),
                "folder_sizes": analyzer.folder_sizes(limit=req.top_n),
                "type_distribution": analyzer.type_distribution(),
                "extension_frequency": analyzer.extension_frequency(limit=max(req.top_n, 50)),
                "pareto": analyzer.pareto_top_consumers(),
                "size_histogram": analyzer.size_histogram(),
                "large_old_default": analyzer.large_and_old_files(
                    min_size=parse_size_to_bytes("500MB"), older_than_days=180, limit=max(req.top_n, 100)
                ),
                "report": report,
            }
            progress_cb({"phase": "analysis", "pct": 100.0, "snapshot_id": sid})
            return full_bundle

    JOBS.submit(job, runner)
    return api_ok({"job_id": job.job_id}, meta={"type": "analysis"})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/largest-files")
async def largest_files(snapshot_id: int, top_n: int = 50):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "largest_files": analyzer.largest_files(limit=top_n)})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/folders")
async def folder_aggregation(snapshot_id: int, top_n: int = 50):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "folders": analyzer.folder_sizes(limit=top_n)})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/types")
async def file_type_distribution(snapshot_id: int):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "types": analyzer.type_distribution()})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/extensions")
async def extension_frequency(snapshot_id: int, top_n: int = 100):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "extensions": analyzer.extension_frequency(limit=top_n)})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/pareto")
async def pareto_analysis(snapshot_id: int):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "pareto": analyzer.pareto_top_consumers()})


@app.get("/api/v1/analysis/snapshots/{snapshot_id}/histogram")
async def size_histogram(snapshot_id: int):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        analyzer = DiskAnalyzer(eng.store, snapshot_id)
        return api_ok({"snapshot_id": snapshot_id, "histogram": analyzer.size_histogram()})


# ------------------------- Duplicate Detection APIs ------------------------- #


@app.post("/api/v1/analysis/duplicates/run", summary="Run duplicate detection")
async def run_duplicates(req: DuplicateRequest):
    job = JOBS.create_job("duplicates")

    def runner(progress_cb: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
            sid = resolve_snapshot_id(eng, req.snapshot_id)
            progress_cb({"phase": "duplicates", "pct": 10.0, "snapshot_id": sid})
            out = DuplicateDetector(eng.store, sid).find_duplicates()
            progress_cb({"phase": "duplicates", "pct": 100.0, "snapshot_id": sid})
            out["snapshot_id"] = sid
            return out

    JOBS.submit(job, runner)
    return api_ok({"job_id": job.job_id}, meta={"type": "duplicates"})


# ------------------------- Large / Old Detection APIs ---------------------- #


@app.post("/api/v1/analysis/filters/large-old", summary="Filter large and old files")
async def filter_large_old(req: LargeOldFilterRequest):
    with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
        sid = resolve_snapshot_id(eng, req.snapshot_id)
        analyzer = DiskAnalyzer(eng.store, sid)
        min_size = parse_size_to_bytes(req.min_size)
        combo = analyzer.large_and_old_files(min_size=min_size, older_than_days=req.older_than_days, limit=req.limit)
        large = analyzer.large_files(min_size=min_size, limit=req.limit)
        old = analyzer.old_files(older_than_days=req.older_than_days, limit=req.limit)
        return api_ok(
            {
                "snapshot_id": sid,
                "filters": {
                    "min_size_bytes": min_size,
                    "min_size_human": human_bytes(min_size),
                    "older_than_days": req.older_than_days,
                },
                "large": large,
                "old": old,
                "large_and_old": combo,
            }
        )


# ------------------------------ Cleanup APIs -------------------------------- #


def select_cleanup_candidates(eng: Engine, req: CleanupRequest, snapshot_id: int) -> list[str]:
    analyzer = DiskAnalyzer(eng.store, snapshot_id)

    if req.mode == "duplicates":
        dup = DuplicateDetector(eng.store, snapshot_id).find_duplicates()
        paths: list[str] = []
        for c in dup.get("clusters", []):
            paths.extend(c.get("remove_paths", []))
        return list(dict.fromkeys(paths))

    if req.mode == "large-old":
        min_size = parse_size_to_bytes(req.min_size)
        items = analyzer.large_and_old_files(min_size=min_size, older_than_days=req.older_than_days, limit=req.limit)
        return [x["path"] for x in items]

    if req.mode == "logs-temp":
        rows = eng.store.conn.execute(
            """
            SELECT path
            FROM files
            WHERE snapshot_id=? AND (
                extension IN ('.log', '.tmp', '.cache', '.trace', '.out', '.err')
                OR path LIKE '%/tmp/%' OR path LIKE '%/cache/%' OR path LIKE '%/var/tmp/%'
            )
            ORDER BY size DESC
            LIMIT ?
            """,
            (snapshot_id, req.limit),
        ).fetchall()
        return [r["path"] for r in rows]

    if req.mode == "paths":
        if not req.paths:
            raise ValueError("mode=paths requires non-empty paths")
        return [os.path.realpath(os.path.expanduser(p)) for p in req.paths]

    raise ValueError(f"Unknown cleanup mode: {req.mode}")


@app.post("/api/v1/cleanup/run", summary="Run cleanup with risk scoring (dry-run default)")
async def run_cleanup(req: CleanupRequest):
    safe_roots = ensure_safe_cleanup_roots(req.roots)

    if req.execute and not req.confirm:
        return api_error(
            "CONFIRMATION_REQUIRED",
            "Destructive cleanup requires confirm=true.",
            status_code=400,
        )

    job = JOBS.create_job("cleanup")

    def runner(progress_cb: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
            sid = resolve_snapshot_id(eng, req.snapshot_id)
            progress_cb({"phase": "candidate_selection", "pct": 10.0, "snapshot_id": sid})
            candidates = select_cleanup_candidates(eng, req, sid)

            filtered = [p for p in candidates if is_under_any(p, safe_roots)]
            dropped = len(candidates) - len(filtered)

            policy = CleanupPolicy(
                dry_run=not req.execute,
                force_high_risk=req.force_high_risk,
                quarantine_mode=req.quarantine_mode,
                confirm=req.confirm,
            )

            progress_cb({"phase": "cleanup_execution", "pct": 50.0, "candidate_count": len(filtered)})
            cleaner = CleanupEngine(
                store=eng.store,
                snapshot_id=sid,
                logger=LOGGER,
                classifier=eng.classifier,
                risk_scorer=RiskScorer(),
                quarantine_dir=QUARANTINE_DIR,
            )
            result = cleaner.execute(filtered, req.mode, policy, safe_roots)
            result["snapshot_id"] = sid
            result["candidate_count"] = len(filtered)
            result["dropped_outside_roots"] = dropped
            result["dry_run_default"] = True
            progress_cb({"phase": "completed", "pct": 100.0})
            return result

    JOBS.submit(job, runner)
    return api_ok({"job_id": job.job_id}, meta={"type": "cleanup"})


@app.post("/api/v1/cleanup/undo", summary="Undo quarantined cleanup action")
async def undo_cleanup(req: UndoRequest):
    job = JOBS.create_job("undo")

    def runner(progress_cb: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        with engine_session(DB_PATH, CLASSIFIER_RULES, LOG_FILE) as eng:
            sid = eng.store.latest_snapshot() or 0
            cleaner = CleanupEngine(
                store=eng.store,
                snapshot_id=sid,
                logger=LOGGER,
                classifier=eng.classifier,
                risk_scorer=RiskScorer(),
                quarantine_dir=QUARANTINE_DIR,
            )
            progress_cb({"phase": "undo", "pct": 10.0})
            out = cleaner.undo(req.action_id)
            progress_cb({"phase": "undo", "pct": 100.0})
            return out

    JOBS.submit(job, runner)
    return api_ok({"job_id": job.job_id}, meta={"type": "undo"})


@app.post("/api/v1/actions/delete-duplicates", summary="Delete duplicate files (safe job wrapper)")
async def action_delete_duplicates(req: CleanupActionRequest):
    cleanup_req = CleanupRequest(
        snapshot_id=req.snapshot_id,
        mode="duplicates",
        roots=req.roots,
        limit=req.limit,
        execute=True,
        force_high_risk=req.force_high_risk,
        quarantine_mode=req.quarantine_mode,
        confirm=req.confirm,
    )
    return await run_cleanup(cleanup_req)


@app.post("/api/v1/actions/delete-large-old", summary="Delete large and old files (safe job wrapper)")
async def action_delete_large_old(req: CleanupActionRequest):
    cleanup_req = CleanupRequest(
        snapshot_id=req.snapshot_id,
        mode="large-old",
        roots=req.roots,
        min_size=req.min_size,
        older_than_days=req.older_than_days,
        limit=req.limit,
        execute=True,
        force_high_risk=req.force_high_risk,
        quarantine_mode=req.quarantine_mode,
        confirm=req.confirm,
    )
    return await run_cleanup(cleanup_req)


@app.post("/api/v1/actions/clean-logs-temp", summary="Delete logs and temp files (safe job wrapper)")
async def action_clean_logs_temp(req: CleanupActionRequest):
    cleanup_req = CleanupRequest(
        snapshot_id=req.snapshot_id,
        mode="logs-temp",
        roots=req.roots,
        limit=req.limit,
        execute=True,
        force_high_risk=req.force_high_risk,
        quarantine_mode=req.quarantine_mode,
        confirm=req.confirm,
    )
    return await run_cleanup(cleanup_req)


# ------------------------------ Health & Root ------------------------------- #


@app.get("/api/v1/actions", summary="List available connected actions")
async def list_actions():
    return api_ok(
        {
            "actions": [
                {
                    "id": "health",
                    "label": "Health Check",
                    "kind": "analysis",
                    "endpoint": "/healthz",
                    "destructive": False,
                },
                {
                    "id": "scan",
                    "label": "Start Scan",
                    "kind": "analysis",
                    "endpoint": "/api/v1/analysis/scans/start",
                    "destructive": False,
                },
                {
                    "id": "analysis",
                    "label": "Run Analysis",
                    "kind": "analysis",
                    "endpoint": "/api/v1/analysis/run",
                    "destructive": False,
                },
                {
                    "id": "duplicates",
                    "label": "Find Duplicates",
                    "kind": "analysis",
                    "endpoint": "/api/v1/analysis/duplicates/run",
                    "destructive": False,
                },
                {
                    "id": "cleanup_dry",
                    "label": "Cleanup Dry-Run",
                    "kind": "cleanup",
                    "endpoint": "/api/v1/cleanup/run",
                    "destructive": False,
                },
                {
                    "id": "delete_duplicates",
                    "label": "Delete Duplicates",
                    "kind": "cleanup",
                    "endpoint": "/api/v1/actions/delete-duplicates",
                    "destructive": True,
                },
                {
                    "id": "delete_large_old",
                    "label": "Delete Large + Old",
                    "kind": "cleanup",
                    "endpoint": "/api/v1/actions/delete-large-old",
                    "destructive": True,
                },
                {
                    "id": "clean_logs_temp",
                    "label": "Clean Logs/Temp",
                    "kind": "cleanup",
                    "endpoint": "/api/v1/actions/clean-logs-temp",
                    "destructive": True,
                },
                {
                    "id": "undo_cleanup",
                    "label": "Undo Cleanup",
                    "kind": "cleanup",
                    "endpoint": "/api/v1/cleanup/undo",
                    "destructive": False,
                },
            ]
        }
    )


@app.get("/healthz", summary="Liveness endpoint")
async def healthz():
    return api_ok({"service": "disk-intelligence-server", "healthy": True})


@app.get("/api/v1/connect", summary="Get connect URL for mobile pairing")
async def get_connect_url(request: Request):
    return api_ok({"connect_url": request_connect_url(request)})


def build_qr_payload(connect_url: str) -> tuple[dict[str, Any], list[str]]:
    payload: dict[str, Any] = {
        "connect_url": connect_url,
        "qr_ascii": None,
        "qr_png_base64": None,
        "qr_data_url": None,
    }
    warnings: list[str] = []

    try:
        import base64
        import io

        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(connect_url)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        ascii_lines = []
        for row in matrix:
            ascii_lines.append("".join("██" if cell else "  " for cell in row))
        payload["qr_ascii"] = "\n".join(ascii_lines)

        img = qrcode.make(connect_url)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        payload["qr_png_base64"] = b64
        payload["qr_data_url"] = f"data:image/png;base64,{b64}"
    except Exception:
        warnings.append("Install qrcode for QR payloads: python3 -m pip install qrcode[pil]")

    return payload, warnings


@app.get("/api/v1/connect/qr", summary="Get connect URL + QR payload for pairing")
async def get_connect_qr(request: Request):
    connect_url = request_connect_url(request)
    payload, warnings = build_qr_payload(connect_url)
    return api_ok(payload, warnings=warnings)


@app.get("/connect", response_class=HTMLResponse, summary="Mobile pairing page with QR")
async def connect_page(request: Request):
    connect_url = request_connect_url(request)
    qr_block = ""
    try:
        import base64
        import io

        import qrcode

        img = qrcode.make(connect_url)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        qr_block = f'<img alt="Connect QR" src="data:image/png;base64,{b64}" style="width:280px;height:280px;border-radius:12px;border:1px solid #1e3328;" />'
    except Exception:
        qr_block = "<p>Install qrcode package for image QR: python3 -m pip install qrcode</p>"

    html = f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Disk Intelligence Connect</title>
        <style>
          body {{ font-family: Arial, sans-serif; background:#0b1410; color:#f0f5f1; margin:0; padding:24px; }}
          .card {{ max-width:560px; margin:0 auto; background:#12201a; border:1px solid #1e3328; border-radius:18px; padding:20px; }}
          .url {{ background:#182a21; padding:10px 12px; border-radius:10px; word-break:break-all; }}
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Connect Mobile App</h2>
          <p>Scan this QR in the app's Connected Devices screen.</p>
          {qr_block}
          <h3>URL</h3>
          <div class="url">{connect_url}</div>
        </div>
      </body>
    </html>
    """
    return HTMLResponse(html)


@app.get("/", summary="Service index")
async def root_index():
    return api_ok(
        {
            "service": "disk-intelligence-server",
            "version": "1.0.0",
            "openapi": "/docs",
            "domains": ["analysis", "cleanup"],
            "core_endpoints": {
                "analysis": [
                    "/api/v1/analysis/scans/start",
                    "/api/v1/analysis/scans/latest",
                    "/api/v1/analysis/run",
                    "/api/v1/analysis/snapshots/{snapshot_id}/largest-files",
                    "/api/v1/analysis/snapshots/{snapshot_id}/folders",
                    "/api/v1/analysis/snapshots/{snapshot_id}/types",
                    "/api/v1/analysis/snapshots/{snapshot_id}/extensions",
                    "/api/v1/analysis/snapshots/{snapshot_id}/pareto",
                    "/api/v1/analysis/snapshots/{snapshot_id}/histogram",
                    "/api/v1/analysis/duplicates/run",
                    "/api/v1/analysis/filters/large-old",
                ],
                "cleanup": [
                    "/api/v1/cleanup/run",
                    "/api/v1/cleanup/undo",
                    "/api/v1/actions/delete-duplicates",
                    "/api/v1/actions/delete-large-old",
                    "/api/v1/actions/clean-logs-temp",
                ],
            },
            "note": "Default deployment should bind to 127.0.0.1 only for local safety.",
        }
    )


# --------------------------------- Runner ---------------------------------- #


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Disk Intelligence FastAPI server")
    parser.add_argument("--host", default=os.getenv("DISK_INTEL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("DISK_INTEL_PORT", "8001")))
    parser.add_argument("--reload", action="store_true")
    return parser.parse_args()


def detect_lan_ip() -> str:
    """Best-effort LAN IP detection for printing connect URL/QR."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def resolve_connect_host(bind_host: str) -> str:
    if bind_host in {"0.0.0.0", "::"}:
        return detect_lan_ip()
    if bind_host in {"127.0.0.1", "localhost"}:
        return "127.0.0.1"
    return bind_host


def print_connect_qr(connect_url: str) -> None:
    """Print ASCII QR to terminal if qrcode package is available."""
    LOGGER.info("Connect URL: %s", connect_url)
    LOGGER.info("Health URL: %s/healthz", connect_url)
    LOGGER.info("Docs URL: %s/docs", connect_url)
    LOGGER.info("Pairing page: %s/connect", connect_url)
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(connect_url)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        print("\nScan this QR from phone:\n")
        for row in matrix:
            line = "".join("██" if cell else "  " for cell in row)
            print(line)
        print()
    except Exception:
        LOGGER.info("Install optional 'qrcode' package for terminal QR: python3 -m pip install qrcode")


def infer_runtime_connect_url() -> str:
    """Infer connect URL when app is started via uvicorn (without main())."""
    if CONNECT_URL:
        return CONNECT_URL

    env_url = os.getenv("DISK_INTEL_CONNECT_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")

    host = os.getenv("DISK_INTEL_HOST", "").strip()
    port = os.getenv("DISK_INTEL_PORT", "8001").strip() or "8001"
    if host:
        connect_host = resolve_connect_host(host)
    else:
        # uvicorn CLI commonly doesn't set DISK_INTEL_HOST, prefer LAN for QR pairing
        connect_host = detect_lan_ip()
    return f"http://{connect_host}:{port}"


def request_connect_url(request: Request) -> str:
    """Build connect URL from request host, with safe LAN fallback."""
    if CONNECT_URL:
        return CONNECT_URL

    host_header = (request.headers.get("host") or "").strip()
    if host_header:
        host_part, _, port_part = host_header.partition(":")
        host = host_part.strip()
        port = port_part.strip() or os.getenv("DISK_INTEL_PORT", "8001")
        if host in {"127.0.0.1", "localhost", "0.0.0.0", "::"}:
            host = detect_lan_ip()
        if host:
            return f"http://{host}:{port}"

    return infer_runtime_connect_url()


def ensure_startup_connect_banner() -> None:
    """Print connect URL/QR exactly once per process startup."""
    global STARTUP_BANNER_PRINTED, CONNECT_URL
    if STARTUP_BANNER_PRINTED:
        return
    connect_url = infer_runtime_connect_url()
    CONNECT_URL = connect_url
    os.environ["DISK_INTEL_CONNECT_URL"] = connect_url
    print_connect_qr(connect_url)
    STARTUP_BANNER_PRINTED = True


def main() -> None:
    import uvicorn

    args = parse_args()
    LOGGER.info("Starting Disk Intelligence Server host=%s port=%s", args.host, args.port)
    connect_host = resolve_connect_host(args.host)
    connect_url = f"http://{connect_host}:{args.port}"
    global CONNECT_URL
    CONNECT_URL = connect_url
    os.environ["DISK_INTEL_CONNECT_URL"] = connect_url
    ensure_startup_connect_banner()
    uvicorn.run(
        "python_scripts.disk_intelligence_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
