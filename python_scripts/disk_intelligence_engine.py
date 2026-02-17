#!/usr/bin/env python3
"""Disk Intelligence and Cleanup Engine (Linux)

Professional-grade, safety-first disk analysis framework with:
- High-performance recursive scanning
- SQLite-backed snapshots and growth tracking
- Duplicate detection (size -> partial hash -> full hash)
- Risk-scored cleanup with dry-run default
- Quarantine + undo support
- Dev-waste analysis suggestions
- Carbon impact estimation (explicitly approximate)
- Visual reporting exports

This tool is Linux-focused and optimized for large trees (100k+ files).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import dataclasses
import datetime as dt
import functools
import hashlib
import itertools
import json
import logging
import math
import os
import re
import shutil
import sqlite3
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

# ------------------------------- Constants ---------------------------------- #

APP_NAME = "disk_intel"
DEFAULT_DB = Path.home() / ".local" / "share" / APP_NAME / "disk_intel.db"
DEFAULT_QUARANTINE_DIR = Path.home() / ".local" / "share" / APP_NAME / "quarantine"
DEFAULT_EXPORT_DIR = Path.cwd() / "disk_intel_reports"
DEFAULT_LOG_FILE = Path.home() / ".local" / "share" / APP_NAME / "actions.log"

SCAN_BATCH_SIZE = 2000
FULL_HASH_BUFFER = 1024 * 1024
PARTIAL_HASH_BYTES = 64 * 1024

CRITICAL_DELETE_PATHS = {
    "/",
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
}

DEFAULT_SKIP_PREFIXES = {
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/snap",
}

DEFAULT_SKIP_NAMES = {
    ".git",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    "node_modules/.cache",
}


# ------------------------------- Utilities ---------------------------------- #


def now_utc_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def human_bytes(size: int) -> str:
    val = float(max(size, 0))
    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if val < 1024.0 or unit == "PB":
            if unit == "B":
                return f"{int(val)} {unit}"
            return f"{val:.2f} {unit}"
        val /= 1024.0
    return f"{size} B"


def parse_size_to_bytes(value: str) -> int:
    text = value.strip().lower().replace(" ", "")
    units: list[tuple[str, int]] = [
        ("tb", 1024**4),
        ("gb", 1024**3),
        ("mb", 1024**2),
        ("kb", 1024),
        ("b", 1),
    ]
    for u, factor in units:
        if text.endswith(u):
            number = float(text[: -len(u)] or "0")
            return int(number * factor)
    return int(float(text))


def days_since(epoch: float, now_ts: float | None = None) -> int:
    ref = now_ts if now_ts is not None else time.time()
    return max(0, int((ref - epoch) // 86400))


def is_subpath(path: str, root: str) -> bool:
    p = os.path.realpath(path)
    r = os.path.realpath(root)
    return p == r or p.startswith(r + os.sep)


def run_command(command: list[str], timeout: int = 120) -> tuple[int, str, str]:
    import subprocess

    try:
        cp = subprocess.run(
            command,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        return cp.returncode, cp.stdout, cp.stderr
    except Exception as exc:  # pylint: disable=broad-except
        return 1, "", str(exc)


def setup_logger(log_file: Path) -> logging.Logger:
    logger = logging.getLogger(APP_NAME)
    if logger.handlers:
        return logger

    chosen = log_file
    try:
        ensure_parent(log_file)
    except OSError:
        chosen = Path("/tmp") / APP_NAME / "actions.log"
        ensure_parent(chosen)

    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(chosen, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


# ------------------------------ Data Models --------------------------------- #


@dataclasses.dataclass(slots=True)
class ScanConfig:
    roots: list[str]
    follow_symlinks: bool = False
    skip_prefixes: set[str] = dataclasses.field(default_factory=lambda: set(DEFAULT_SKIP_PREFIXES))
    skip_names: set[str] = dataclasses.field(default_factory=lambda: set(DEFAULT_SKIP_NAMES))
    include_hidden: bool = True
    store_dir_aggregate_depth: int = 2


@dataclasses.dataclass(slots=True)
class RiskAssessment:
    score: int
    level: str
    reasons: list[str]


@dataclasses.dataclass(slots=True)
class CleanupPolicy:
    dry_run: bool = True
    force_high_risk: bool = False
    quarantine_mode: bool = True
    confirm: bool = False


@dataclasses.dataclass(slots=True)
class DuplicateCluster:
    cluster_id: str
    size_each: int
    file_count: int
    potential_waste: int
    keep_path: str
    remove_paths: list[str]


# ---------------------------- Classification -------------------------------- #


class FileClassifier:
    """Classify file into broad categories with customizable extension rules."""

    DEFAULT_RULES: dict[str, set[str]] = {
        "media": {
            ".mp3", ".wav", ".flac", ".aac", ".mp4", ".mkv", ".avi", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"
        },
        "code": {
            ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".rb", ".php", ".swift", ".sh", ".sql"
        },
        "archives": {
            ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".iso"
        },
        "documents": {
            ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".rtf", ".odt"
        },
        "logs": {".log", ".trace", ".out", ".err"},
        "system": {".so", ".dll", ".sys", ".ko", ".conf", ".service"},
    }

    def __init__(self, custom_rule_file: str | None = None):
        self.rules = {k: set(v) for k, v in self.DEFAULT_RULES.items()}
        if custom_rule_file:
            self._merge_custom_rules(custom_rule_file)

    def _merge_custom_rules(self, rule_file: str) -> None:
        path = Path(rule_file)
        if not path.exists():
            raise FileNotFoundError(f"Custom rule file not found: {rule_file}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Custom classification rules must be a JSON object")
        for category, exts in data.items():
            if not isinstance(exts, list):
                continue
            self.rules.setdefault(category, set()).update({str(x).lower() for x in exts})

    def classify(self, path: str, extension: str) -> str:
        p = path.lower()
        ext = extension.lower()

        if any(seg in p for seg in ["/cache/", "/tmp/", "/var/tmp/"]):
            return "logs" if ext in self.rules.get("logs", set()) else "other"

        for cat, exts in self.rules.items():
            if ext in exts:
                return cat

        if p.startswith(("/etc/", "/usr/", "/var/lib/", "/bin/", "/sbin/")):
            return "system"
        return "other"


# ------------------------------- Risk Engine -------------------------------- #


class RiskScorer:
    """Assess deletion risk based on path, category, visibility, and context."""

    LOW_HINTS = ("/cache/", "/tmp/", "/var/tmp/", ".log", ".tmp", ".cache")

    def assess(self, path: str, category: str, is_hidden: bool) -> RiskAssessment:
        rp = os.path.realpath(path)
        reasons: list[str] = []
        score = 0

        if rp in CRITICAL_DELETE_PATHS or any(is_subpath(rp, p) for p in CRITICAL_DELETE_PATHS if p != "/"):
            score += 95
            reasons.append("system-critical path")

        if category == "system":
            score += 70
            reasons.append("system category")

        if is_hidden:
            score += 25
            reasons.append("hidden file/config")

        if any(h in rp.lower() for h in self.LOW_HINTS):
            score -= 30
            reasons.append("cache/temp/log-like path")

        score = max(0, min(100, score))
        if score >= 70:
            level = "high"
        elif score >= 35:
            level = "medium"
        else:
            level = "low"

        if not reasons:
            reasons.append("no explicit risk triggers")

        return RiskAssessment(score=score, level=level, reasons=reasons)


# ------------------------------ SQLite Store -------------------------------- #


class SnapshotStore:
    """SQLite persistence for snapshots, files, cleanup logs, and quarantine manifests."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        ensure_parent(db_path)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL;")
        self.conn.execute("PRAGMA synchronous=NORMAL;")
        self.conn.execute("PRAGMA temp_store=MEMORY;")
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              roots_json TEXT NOT NULL,
              total_files INTEGER DEFAULT 0,
              total_bytes INTEGER DEFAULT 0,
              duration_sec REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS files (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              snapshot_id INTEGER NOT NULL,
              path TEXT NOT NULL,
              dir_path TEXT NOT NULL,
              top_dir TEXT NOT NULL,
              size INTEGER NOT NULL,
              extension TEXT NOT NULL,
              mtime REAL NOT NULL,
              permissions TEXT NOT NULL,
              is_hidden INTEGER NOT NULL,
              is_symlink INTEGER NOT NULL,
              category TEXT NOT NULL,
              FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
            );

            CREATE INDEX IF NOT EXISTS idx_files_snapshot ON files(snapshot_id);
            CREATE INDEX IF NOT EXISTS idx_files_size ON files(snapshot_id, size);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(snapshot_id, extension);
            CREATE INDEX IF NOT EXISTS idx_files_category ON files(snapshot_id, category);
            CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(snapshot_id, mtime);
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(snapshot_id, path);
            CREATE INDEX IF NOT EXISTS idx_files_topdir ON files(snapshot_id, top_dir);

            CREATE TABLE IF NOT EXISTS cleanup_actions (
              action_id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              snapshot_id INTEGER,
              mode TEXT NOT NULL,
              dry_run INTEGER NOT NULL,
              details_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cleanup_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              action_id TEXT NOT NULL,
              path TEXT NOT NULL,
              status TEXT NOT NULL,
              risk_level TEXT NOT NULL,
              risk_score INTEGER NOT NULL,
              reason TEXT NOT NULL,
              quarantine_path TEXT,
              error TEXT,
              FOREIGN KEY(action_id) REFERENCES cleanup_actions(action_id)
            );

            CREATE INDEX IF NOT EXISTS idx_cleanup_action ON cleanup_items(action_id);

            CREATE TABLE IF NOT EXISTS quarantine_manifest (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              action_id TEXT NOT NULL,
              original_path TEXT NOT NULL,
              quarantine_path TEXT NOT NULL,
              restored_at TEXT
            );
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def create_snapshot(self, roots: Sequence[str]) -> int:
        cur = self.conn.execute(
            "INSERT INTO snapshots(created_at, roots_json) VALUES(?, ?)",
            (now_utc_iso(), json.dumps(list(roots))),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def finalize_snapshot(self, snapshot_id: int, total_files: int, total_bytes: int, duration_sec: float) -> None:
        self.conn.execute(
            "UPDATE snapshots SET total_files=?, total_bytes=?, duration_sec=? WHERE id=?",
            (total_files, total_bytes, duration_sec, snapshot_id),
        )
        self.conn.commit()

    def insert_file_batch(self, rows: list[tuple[Any, ...]]) -> None:
        self.conn.executemany(
            """
            INSERT INTO files(
              snapshot_id, path, dir_path, top_dir, size, extension, mtime,
              permissions, is_hidden, is_symlink, category
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

    def commit(self) -> None:
        self.conn.commit()

    def latest_snapshot(self) -> int | None:
        row = self.conn.execute("SELECT id FROM snapshots ORDER BY id DESC LIMIT 1").fetchone()
        return int(row["id"]) if row else None

    def previous_snapshot(self, snapshot_id: int) -> int | None:
        row = self.conn.execute(
            "SELECT id FROM snapshots WHERE id < ? ORDER BY id DESC LIMIT 1",
            (snapshot_id,),
        ).fetchone()
        return int(row["id"]) if row else None

    def snapshot_row(self, snapshot_id: int) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM snapshots WHERE id=?", (snapshot_id,)).fetchone()
        if row is None:
            raise ValueError(f"Snapshot not found: {snapshot_id}")
        return row


# -------------------------------- Scanner ----------------------------------- #


class FileScanner:
    """Efficient iterative scanner using os.scandir with batched SQLite inserts."""

    def __init__(self, config: ScanConfig, classifier: FileClassifier):
        self.config = config
        self.classifier = classifier

    def _should_skip_path(self, path: str) -> bool:
        rp = os.path.realpath(path)
        if any(rp == p or rp.startswith(p + os.sep) for p in self.config.skip_prefixes):
            return True
        if os.path.basename(path) in self.config.skip_names:
            return True
        return False

    def _top_dir(self, root: str, path: str, depth: int) -> str:
        rel = os.path.relpath(path, root)
        if rel == ".":
            return root
        parts = rel.split(os.sep)
        prefix = parts[: max(1, depth)]
        return os.path.join(root, *prefix)

    def scan_to_store(self, store: SnapshotStore, snapshot_id: int) -> dict[str, Any]:
        started = time.perf_counter()
        total_files = 0
        total_bytes = 0
        errors: list[dict[str, str]] = []

        batch: list[tuple[Any, ...]] = []

        roots = [os.path.realpath(os.path.expanduser(r)) for r in self.config.roots]
        roots = [r for r in roots if os.path.isdir(r)]

        for root in roots:
            if self._should_skip_path(root):
                continue
            stack = [root]
            while stack:
                current = stack.pop()
                if self._should_skip_path(current):
                    continue

                try:
                    with os.scandir(current) as it:
                        for entry in it:
                            full_path = entry.path
                            if self._should_skip_path(full_path):
                                continue

                            name = entry.name
                            if not self.config.include_hidden and name.startswith("."):
                                continue

                            try:
                                is_dir = entry.is_dir(follow_symlinks=self.config.follow_symlinks)
                                is_file = entry.is_file(follow_symlinks=self.config.follow_symlinks)
                            except OSError as exc:
                                errors.append({"path": full_path, "error": str(exc)})
                                continue

                            if is_dir:
                                stack.append(full_path)
                                continue

                            if not is_file:
                                continue

                            try:
                                st = entry.stat(follow_symlinks=self.config.follow_symlinks)
                            except OSError as exc:
                                errors.append({"path": full_path, "error": str(exc)})
                                continue

                            ext = Path(name).suffix.lower()
                            category = self.classifier.classify(full_path, ext)
                            dir_path = os.path.dirname(full_path)
                            top_dir = self._top_dir(root, dir_path, self.config.store_dir_aggregate_depth)

                            row = (
                                snapshot_id,
                                full_path,
                                dir_path,
                                top_dir,
                                int(st.st_size),
                                ext,
                                float(st.st_mtime),
                                oct(st.st_mode & 0o777),
                                1 if name.startswith(".") else 0,
                                1 if entry.is_symlink() else 0,
                                category,
                            )
                            batch.append(row)
                            total_files += 1
                            total_bytes += int(st.st_size)

                            if len(batch) >= SCAN_BATCH_SIZE:
                                store.insert_file_batch(batch)
                                store.commit()
                                batch.clear()
                except OSError as exc:
                    errors.append({"path": current, "error": str(exc)})

        if batch:
            store.insert_file_batch(batch)
            store.commit()

        duration = time.perf_counter() - started
        store.finalize_snapshot(snapshot_id, total_files, total_bytes, duration)

        return {
            "snapshot_id": snapshot_id,
            "roots": roots,
            "total_files": total_files,
            "total_bytes": total_bytes,
            "duration_sec": round(duration, 3),
            "errors_count": len(errors),
            "errors_sample": errors[:50],
        }


# ------------------------------- Analyzer ----------------------------------- #


class DiskAnalyzer:
    """SQL-backed analysis on a snapshot for performance and scalability."""

    SIZE_HIST_BINS = [
        0,
        4 * 1024,
        64 * 1024,
        1024 * 1024,
        10 * 1024 * 1024,
        100 * 1024 * 1024,
        1024 * 1024 * 1024,
        10 * 1024 * 1024 * 1024,
    ]

    def __init__(self, store: SnapshotStore, snapshot_id: int):
        self.store = store
        self.snapshot_id = snapshot_id

    def summary(self) -> dict[str, Any]:
        row = self.store.snapshot_row(self.snapshot_id)
        return {
            "snapshot_id": self.snapshot_id,
            "created_at": row["created_at"],
            "total_files": int(row["total_files"]),
            "total_bytes": int(row["total_bytes"]),
            "total_human": human_bytes(int(row["total_bytes"])),
            "duration_sec": float(row["duration_sec"]),
            "roots": json.loads(row["roots_json"]),
        }

    def largest_files(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            """
            SELECT path, size, mtime, category
            FROM files
            WHERE snapshot_id=?
            ORDER BY size DESC
            LIMIT ?
            """,
            (self.snapshot_id, limit),
        ).fetchall()
        return [
            {
                "path": r["path"],
                "size": int(r["size"]),
                "size_human": human_bytes(int(r["size"])),
                "mtime": float(r["mtime"]),
                "category": r["category"],
            }
            for r in rows
        ]

    def folder_sizes(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            """
            SELECT top_dir, SUM(size) AS total, COUNT(*) AS file_count
            FROM files
            WHERE snapshot_id=?
            GROUP BY top_dir
            ORDER BY total DESC
            LIMIT ?
            """,
            (self.snapshot_id, limit),
        ).fetchall()
        return [
            {
                "folder": r["top_dir"],
                "bytes": int(r["total"]),
                "bytes_human": human_bytes(int(r["total"])),
                "file_count": int(r["file_count"]),
            }
            for r in rows
        ]

    def type_distribution(self) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            """
            SELECT category, COUNT(*) AS file_count, SUM(size) AS total
            FROM files
            WHERE snapshot_id=?
            GROUP BY category
            ORDER BY total DESC
            """,
            (self.snapshot_id,),
        ).fetchall()
        return [
            {
                "category": r["category"],
                "files": int(r["file_count"]),
                "bytes": int(r["total"]),
                "bytes_human": human_bytes(int(r["total"])),
            }
            for r in rows
        ]

    def extension_frequency(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            """
            SELECT extension, COUNT(*) AS file_count, SUM(size) AS total
            FROM files
            WHERE snapshot_id=?
            GROUP BY extension
            ORDER BY file_count DESC
            LIMIT ?
            """,
            (self.snapshot_id, limit),
        ).fetchall()
        return [
            {
                "extension": r["extension"] or "(none)",
                "files": int(r["file_count"]),
                "bytes": int(r["total"]),
                "bytes_human": human_bytes(int(r["total"])),
            }
            for r in rows
        ]

    def pareto_top_consumers(self) -> dict[str, Any]:
        folders = self.folder_sizes(limit=20000)
        total = sum(item["bytes"] for item in folders) or 1
        target = total * 0.8
        running = 0
        chosen: list[dict[str, Any]] = []
        for f in folders:
            chosen.append(f)
            running += f["bytes"]
            if running >= target:
                break

        return {
            "target_bytes_80pct": int(target),
            "target_human_80pct": human_bytes(int(target)),
            "folder_count_needed": len(chosen),
            "total_folders": len(folders),
            "coverage_pct": round(running * 100.0 / total, 2),
            "top_consumers": chosen[:200],
        }

    def size_histogram(self) -> dict[str, int]:
        rows = self.store.conn.execute(
            "SELECT size FROM files WHERE snapshot_id=?",
            (self.snapshot_id,),
        )
        bins = self.SIZE_HIST_BINS
        labels = []
        for i in range(len(bins) - 1):
            labels.append(f"{human_bytes(bins[i])}-{human_bytes(bins[i + 1])}")
        labels.append(f">={human_bytes(bins[-1])}")

        hist = Counter({label: 0 for label in labels})

        for r in rows:
            size = int(r["size"])
            placed = False
            for i in range(len(bins) - 1):
                if bins[i] <= size < bins[i + 1]:
                    hist[labels[i]] += 1
                    placed = True
                    break
            if not placed:
                hist[labels[-1]] += 1

        return dict(hist)

    def large_files(self, min_size: int, limit: int = 1000) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            """
            SELECT path, size, mtime, category
            FROM files
            WHERE snapshot_id=? AND size>=?
            ORDER BY size DESC
            LIMIT ?
            """,
            (self.snapshot_id, min_size, limit),
        ).fetchall()
        return [
            {
                "path": r["path"],
                "size": int(r["size"]),
                "size_human": human_bytes(int(r["size"])),
                "mtime": float(r["mtime"]),
                "category": r["category"],
            }
            for r in rows
        ]

    def old_files(self, older_than_days: int, limit: int = 1000) -> list[dict[str, Any]]:
        cutoff = time.time() - older_than_days * 86400
        rows = self.store.conn.execute(
            """
            SELECT path, size, mtime, category
            FROM files
            WHERE snapshot_id=? AND mtime<=?
            ORDER BY mtime ASC
            LIMIT ?
            """,
            (self.snapshot_id, cutoff, limit),
        ).fetchall()
        return [
            {
                "path": r["path"],
                "size": int(r["size"]),
                "size_human": human_bytes(int(r["size"])),
                "days_old": days_since(float(r["mtime"])),
                "category": r["category"],
            }
            for r in rows
        ]

    def large_and_old_files(self, min_size: int, older_than_days: int, limit: int = 1000) -> list[dict[str, Any]]:
        cutoff = time.time() - older_than_days * 86400
        rows = self.store.conn.execute(
            """
            SELECT path, size, mtime, category
            FROM files
            WHERE snapshot_id=? AND size>=? AND mtime<=?
            ORDER BY size DESC
            LIMIT ?
            """,
            (self.snapshot_id, min_size, cutoff, limit),
        ).fetchall()
        return [
            {
                "path": r["path"],
                "size": int(r["size"]),
                "size_human": human_bytes(int(r["size"])),
                "days_old": days_since(float(r["mtime"])),
                "category": r["category"],
            }
            for r in rows
        ]

    def growth_compare_previous(self) -> dict[str, Any]:
        prev = self.store.previous_snapshot(self.snapshot_id)
        if prev is None:
            return {
                "has_previous": False,
                "message": "No previous snapshot available.",
                "snapshot_id": self.snapshot_id,
            }

        cur_row = self.store.snapshot_row(self.snapshot_id)
        prev_row = self.store.snapshot_row(prev)

        cur_total = int(cur_row["total_bytes"])
        prev_total = int(prev_row["total_bytes"])
        delta = cur_total - prev_total

        cur_dirs = self.store.conn.execute(
            "SELECT top_dir, SUM(size) AS b FROM files WHERE snapshot_id=? GROUP BY top_dir",
            (self.snapshot_id,),
        ).fetchall()
        prev_dirs = self.store.conn.execute(
            "SELECT top_dir, SUM(size) AS b FROM files WHERE snapshot_id=? GROUP BY top_dir",
            (prev,),
        ).fetchall()

        cur_map = {r["top_dir"]: int(r["b"]) for r in cur_dirs}
        prev_map = {r["top_dir"]: int(r["b"]) for r in prev_dirs}

        all_dirs = set(cur_map) | set(prev_map)
        dir_growth = []
        for d in all_dirs:
            diff = cur_map.get(d, 0) - prev_map.get(d, 0)
            if diff != 0:
                dir_growth.append({
                    "folder": d,
                    "delta_bytes": diff,
                    "delta_human": human_bytes(abs(diff)),
                    "direction": "growth" if diff > 0 else "shrink",
                })

        dir_growth.sort(key=lambda x: abs(x["delta_bytes"]), reverse=True)

        churn = self._file_churn(prev)

        return {
            "has_previous": True,
            "current_snapshot": self.snapshot_id,
            "previous_snapshot": prev,
            "current_total_bytes": cur_total,
            "previous_total_bytes": prev_total,
            "delta_bytes": delta,
            "delta_human": human_bytes(abs(delta)),
            "direction": "growth" if delta > 0 else "shrink" if delta < 0 else "flat",
            "folder_level_changes": dir_growth[:200],
            "file_churn": churn,
        }

    def _file_churn(self, prev_snapshot_id: int) -> dict[str, Any]:
        # Added files: exists now not before (by path)
        added = self.store.conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM files c
            WHERE c.snapshot_id=?
              AND NOT EXISTS (
                SELECT 1 FROM files p
                WHERE p.snapshot_id=? AND p.path=c.path
              )
            """,
            (self.snapshot_id, prev_snapshot_id),
        ).fetchone()["n"]

        removed = self.store.conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM files p
            WHERE p.snapshot_id=?
              AND NOT EXISTS (
                SELECT 1 FROM files c
                WHERE c.snapshot_id=? AND c.path=p.path
              )
            """,
            (prev_snapshot_id, self.snapshot_id),
        ).fetchone()["n"]

        changed = self.store.conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM files c
            JOIN files p ON c.path=p.path
            WHERE c.snapshot_id=? AND p.snapshot_id=?
              AND (c.size != p.size OR c.mtime != p.mtime)
            """,
            (self.snapshot_id, prev_snapshot_id),
        ).fetchone()["n"]

        total = self.store.snapshot_row(self.snapshot_id)["total_files"] or 1
        churn_rate = (int(added) + int(removed) + int(changed)) * 100.0 / int(total)
        return {
            "added": int(added),
            "removed": int(removed),
            "changed": int(changed),
            "churn_rate_pct": round(churn_rate, 3),
        }

    def growth_history(self) -> list[dict[str, Any]]:
        rows = self.store.conn.execute(
            "SELECT id, created_at, total_files, total_bytes FROM snapshots ORDER BY id ASC"
        ).fetchall()
        return [
            {
                "snapshot_id": int(r["id"]),
                "created_at": r["created_at"],
                "total_files": int(r["total_files"]),
                "total_bytes": int(r["total_bytes"]),
                "total_human": human_bytes(int(r["total_bytes"])),
            }
            for r in rows
        ]

    def predict_disk_fill(self) -> dict[str, Any]:
        history = self.growth_history()
        if len(history) < 3:
            return {
                "has_prediction": False,
                "assumptions": ["Requires at least 3 snapshots for linear trend."],
                "points": len(history),
            }

        t0 = dt.datetime.fromisoformat(history[0]["created_at"]).timestamp()
        x = []
        y = []
        for h in history:
            ts = dt.datetime.fromisoformat(h["created_at"]).timestamp()
            days = (ts - t0) / 86400.0
            x.append(days)
            y.append(float(h["total_bytes"]))

        # Linear regression y = a + b*x
        n = len(x)
        mean_x = statistics.fmean(x)
        mean_y = statistics.fmean(y)
        num = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
        den = sum((xi - mean_x) ** 2 for xi in x)
        if den == 0:
            return {
                "has_prediction": False,
                "assumptions": ["Insufficient time variance between snapshots."],
                "points": len(history),
            }
        slope = num / den
        intercept = mean_y - slope * mean_x

        roots = self.summary().get("roots", [])
        root = roots[0] if roots else "/"
        usage = shutil.disk_usage(root)
        disk_total = float(usage.total)

        if slope <= 0:
            return {
                "has_prediction": False,
                "assumptions": ["Linear trend indicates stable/decreasing usage."],
                "slope_bytes_per_day": slope,
                "disk_total_bytes": int(disk_total),
            }

        # Solve disk_total = intercept + slope * day
        day_to_full = (disk_total - intercept) / slope
        if day_to_full <= x[-1]:
            eta_days = 0.0
        else:
            eta_days = day_to_full - x[-1]

        current_dt = dt.datetime.fromisoformat(history[-1]["created_at"])  # aware UTC
        predicted = current_dt + dt.timedelta(days=eta_days)

        return {
            "has_prediction": True,
            "model": "linear_regression",
            "slope_bytes_per_day": slope,
            "intercept": intercept,
            "disk_total_bytes": int(disk_total),
            "disk_total_human": human_bytes(int(disk_total)),
            "predicted_full_date": predicted.isoformat(),
            "eta_days": round(eta_days, 2),
            "assumptions": [
                "Assumes linear growth trend based on historical snapshots.",
                "Assumes no major cleanup or unusual future storage events.",
            ],
        }


# --------------------------- Duplicate Detection ---------------------------- #


def _hash_partial(path: str, bytes_to_read: int = PARTIAL_HASH_BYTES) -> tuple[str, str | None, str | None]:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            chunk = f.read(bytes_to_read)
            h.update(chunk)
        return path, h.hexdigest(), None
    except Exception as exc:  # pylint: disable=broad-except
        return path, None, str(exc)


def _hash_full(path: str, buffer_size: int = FULL_HASH_BUFFER) -> tuple[str, str | None, str | None]:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(buffer_size)
                if not chunk:
                    break
                h.update(chunk)
        return path, h.hexdigest(), None
    except Exception as exc:  # pylint: disable=broad-except
        return path, None, str(exc)


class DuplicateDetector:
    """Three-phase duplicate detector with multiprocessing for hashing."""

    def __init__(self, store: SnapshotStore, snapshot_id: int, workers: int | None = None):
        self.store = store
        self.snapshot_id = snapshot_id
        self.workers = workers or max(1, (os.cpu_count() or 2) - 1)

    def _hash_map(
        self,
        fn: Any,
        paths: list[str],
        chunksize: int,
    ) -> Iterator[tuple[str, str | None, str | None]]:
        try:
            with concurrent.futures.ProcessPoolExecutor(max_workers=self.workers) as ex:
                yield from ex.map(fn, paths, chunksize=chunksize)
            return
        except (PermissionError, OSError):
            # Fallback for restricted environments where process pools are blocked.
            pass

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.workers) as ex:
            yield from ex.map(fn, paths, chunksize=chunksize)

    def find_duplicates(self, limit_candidate_groups: int = 200000) -> dict[str, Any]:
        cur = self.store.conn.execute(
            """
            SELECT size, COUNT(*) AS c
            FROM files
            WHERE snapshot_id=? AND size>0
            GROUP BY size
            HAVING c > 1
            ORDER BY c DESC
            """,
            (self.snapshot_id,),
        )

        candidate_sizes = [int(r["size"]) for r in cur.fetchall()]
        if not candidate_sizes:
            return {
                "cluster_count": 0,
                "potential_waste_bytes": 0,
                "clusters": [],
                "errors": [],
                "phase_stats": {"size_groups": 0, "partial_groups": 0, "full_groups": 0},
            }

        # Fetch candidate files by size
        candidates: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []

        for size in candidate_sizes:
            rows = self.store.conn.execute(
                "SELECT path, size, mtime FROM files WHERE snapshot_id=? AND size=?",
                (self.snapshot_id, size),
            ).fetchall()
            for r in rows:
                candidates.append({
                    "path": r["path"],
                    "size": int(r["size"]),
                    "mtime": float(r["mtime"]),
                })

        if len(candidates) > limit_candidate_groups:
            candidates = candidates[:limit_candidate_groups]

        # Phase 2: partial hash
        path_meta = {c["path"]: c for c in candidates}
        partial_groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for path, digest, err in self._hash_map(_hash_partial, [c["path"] for c in candidates], chunksize=64):
            c = path_meta.get(path)
            if c is None:
                continue
            if err or not digest:
                errors.append({"path": path, "error": err or "partial hash failed"})
                continue
            partial_groups[(c["size"], digest)].append(c)

        # Phase 3: full hash for partial collisions
        full_candidates = [group for group in partial_groups.values() if len(group) > 1]
        flat_full = list(itertools.chain.from_iterable(full_candidates))

        full_digest_by_path: dict[str, str] = {}
        for path, digest, err in self._hash_map(_hash_full, [c["path"] for c in flat_full], chunksize=32):
            if err or not digest:
                errors.append({"path": path, "error": err or "full hash failed"})
                continue
            full_digest_by_path[path] = digest

        by_full: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for c in flat_full:
            d = full_digest_by_path.get(c["path"])
            if d:
                by_full[d].append(c)

        clusters: list[DuplicateCluster] = []
        for digest, group in by_full.items():
            if len(group) < 2:
                continue
            # keep oldest modified file (conservative)
            group_sorted = sorted(group, key=lambda x: (x["mtime"], x["path"]))
            keep = group_sorted[0]
            remove = [g["path"] for g in group_sorted[1:]]
            size_each = group_sorted[0]["size"]
            cluster = DuplicateCluster(
                cluster_id=digest[:16],
                size_each=size_each,
                file_count=len(group_sorted),
                potential_waste=size_each * (len(group_sorted) - 1),
                keep_path=keep["path"],
                remove_paths=remove,
            )
            clusters.append(cluster)

        clusters.sort(key=lambda c: c.potential_waste, reverse=True)
        total_waste = sum(c.potential_waste for c in clusters)

        return {
            "cluster_count": len(clusters),
            "potential_waste_bytes": total_waste,
            "potential_waste_human": human_bytes(total_waste),
            "phase_stats": {
                "size_groups": len(candidate_sizes),
                "partial_groups": len(partial_groups),
                "full_groups": len(by_full),
            },
            "clusters": [dataclasses.asdict(c) | {"size_each_human": human_bytes(c.size_each), "potential_waste_human": human_bytes(c.potential_waste)} for c in clusters],
            "errors": errors[:200],
        }


# ----------------------------- Dev Waste Scan ------------------------------- #


class DevWasteAnalyzer:
    """Detect common development-environment storage waste patterns."""

    CACHE_PATTERNS = [
        "/.cache/pip",
        "/.npm/_cacache",
        "/.cache/yarn",
        "/.cache/pnpm",
        "/var/cache/pacman/pkg",
        "/.cache/go-build",
        "/.cargo/registry",
    ]

    BUILD_HINTS = {"dist", "build", "target", ".next", ".nuxt", "out", "coverage"}

    def __init__(self, store: SnapshotStore, snapshot_id: int):
        self.store = store
        self.snapshot_id = snapshot_id

    def analyze(self) -> dict[str, Any]:
        suggestions: list[dict[str, Any]] = []

        # node_modules
        node = self.store.conn.execute(
            """
            SELECT top_dir, SUM(size) AS b, COUNT(*) AS c
            FROM files
            WHERE snapshot_id=? AND path LIKE '%/node_modules/%'
            GROUP BY top_dir
            ORDER BY b DESC
            LIMIT 200
            """,
            (self.snapshot_id,),
        ).fetchall()
        if node:
            total = sum(int(r["b"]) for r in node)
            suggestions.append({
                "type": "node_modules_duplication",
                "estimated_bytes": total,
                "estimated_human": human_bytes(total),
                "recommendation": "Review monorepo/package dedupe and remove unused node_modules trees.",
                "top_locations": [
                    {"folder": r["top_dir"], "bytes": int(r["b"]), "bytes_human": human_bytes(int(r["b"])), "files": int(r["c"])}
                    for r in node[:20]
                ],
            })

        # virtualenvs
        venv = self.store.conn.execute(
            """
            SELECT top_dir, SUM(size) AS b, COUNT(*) AS c
            FROM files
            WHERE snapshot_id=?
              AND (path LIKE '%/.venv/%' OR path LIKE '%/venv/%' OR path LIKE '%/env/%')
            GROUP BY top_dir
            ORDER BY b DESC
            LIMIT 200
            """,
            (self.snapshot_id,),
        ).fetchall()
        if venv:
            total = sum(int(r["b"]) for r in venv)
            suggestions.append({
                "type": "virtualenv_accumulation",
                "estimated_bytes": total,
                "estimated_human": human_bytes(total),
                "recommendation": "Remove stale virtual environments and rebuild from lock files when needed.",
                "top_locations": [
                    {"folder": r["top_dir"], "bytes": int(r["b"]), "bytes_human": human_bytes(int(r["b"])), "files": int(r["c"])}
                    for r in venv[:20]
                ],
            })

        # package caches
        cache_hits = []
        for patt in self.CACHE_PATTERNS:
            r = self.store.conn.execute(
                """
                SELECT SUM(size) AS b, COUNT(*) AS c
                FROM files
                WHERE snapshot_id=? AND path LIKE ?
                """,
                (self.snapshot_id, f"%{patt}%"),
            ).fetchone()
            b = int(r["b"] or 0)
            c = int(r["c"] or 0)
            if b > 0:
                cache_hits.append({"pattern": patt, "bytes": b, "bytes_human": human_bytes(b), "files": c})

        if cache_hits:
            total = sum(i["bytes"] for i in cache_hits)
            suggestions.append({
                "type": "package_manager_caches",
                "estimated_bytes": total,
                "estimated_human": human_bytes(total),
                "recommendation": "Use package-manager-specific cleanup commands; avoid deleting active caches blindly.",
                "details": cache_hits,
            })

        # build artifacts
        builds = self.store.conn.execute(
            """
            SELECT top_dir, SUM(size) AS b, COUNT(*) AS c
            FROM files
            WHERE snapshot_id=? AND (
                path LIKE '%/dist/%' OR path LIKE '%/build/%' OR path LIKE '%/target/%' OR
                path LIKE '%/.next/%' OR path LIKE '%/.nuxt/%' OR path LIKE '%/coverage/%'
            )
            GROUP BY top_dir
            ORDER BY b DESC
            LIMIT 200
            """,
            (self.snapshot_id,),
        ).fetchall()
        if builds:
            total = sum(int(r["b"]) for r in builds)
            suggestions.append({
                "type": "build_artifacts",
                "estimated_bytes": total,
                "estimated_human": human_bytes(total),
                "recommendation": "Delete generated artifacts that can be rebuilt from source.",
                "top_locations": [
                    {"folder": r["top_dir"], "bytes": int(r["b"]), "bytes_human": human_bytes(int(r["b"])), "files": int(r["c"])}
                    for r in builds[:20]
                ],
            })

        # docker dangling images (suggest only)
        docker_info = self._docker_dangling_info()
        if docker_info:
            suggestions.append(docker_info)

        return {
            "snapshot_id": self.snapshot_id,
            "suggestions": suggestions,
        }

    def _docker_dangling_info(self) -> dict[str, Any] | None:
        if not shutil.which("docker"):
            return None
        rc, out, err = run_command(["docker", "image", "ls", "-f", "dangling=true", "--format", "{{.ID}} {{.Size}}"], timeout=30)
        if rc != 0:
            return {
                "type": "docker_dangling_images",
                "available": False,
                "message": "Could not query docker dangling images.",
                "error": err.strip(),
                "recommendation": "If Docker is in use, run: docker image prune -f",
            }

        lines = [line.strip() for line in out.splitlines() if line.strip()]
        return {
            "type": "docker_dangling_images",
            "available": True,
            "count": len(lines),
            "sample": lines[:20],
            "recommendation": "Run docker image prune -f to remove dangling images (review first).",
        }


# ------------------------------ Carbon Model -------------------------------- #


class CarbonEstimator:
    """Approximate storage environmental impact model (explicitly estimated)."""

    # Explicit assumptions: conservative and labeled as approximations.
    # Rough blended estimate for storage energy footprint per GB-year.
    KWH_PER_GB_YEAR = 0.65
    CO2_KG_PER_KWH = 0.40
    LAPTOP_KWH_PER_HOUR = 0.06

    @classmethod
    def estimate(cls, total_bytes: int) -> dict[str, Any]:
        gb = total_bytes / (1024 ** 3)
        annual_kwh = gb * cls.KWH_PER_GB_YEAR
        annual_co2_kg = annual_kwh * cls.CO2_KG_PER_KWH
        laptop_hours = annual_kwh / cls.LAPTOP_KWH_PER_HOUR if cls.LAPTOP_KWH_PER_HOUR > 0 else 0

        return {
            "stored_bytes": int(total_bytes),
            "stored_human": human_bytes(total_bytes),
            "stored_gb": round(gb, 3),
            "estimated_annual_energy_kwh": round(annual_kwh, 3),
            "estimated_annual_co2_kg": round(annual_co2_kg, 3),
            "context_equivalent_laptop_hours": round(laptop_hours, 2),
            "assumptions": [
                "This is an estimation, not a direct measurement.",
                f"Energy factor assumed: {cls.KWH_PER_GB_YEAR} kWh per GB-year.",
                f"Grid carbon factor assumed: {cls.CO2_KG_PER_KWH} kg CO2 per kWh.",
            ],
        }


# ------------------------------ Cleanup Engine ------------------------------ #


class CleanupEngine:
    """Safety-first cleanup with risk scoring, dry-run default, quarantine, and undo."""

    def __init__(
        self,
        store: SnapshotStore,
        snapshot_id: int,
        logger: logging.Logger,
        classifier: FileClassifier,
        risk_scorer: RiskScorer,
        quarantine_dir: Path = DEFAULT_QUARANTINE_DIR,
    ):
        self.store = store
        self.snapshot_id = snapshot_id
        self.logger = logger
        self.classifier = classifier
        self.risk_scorer = risk_scorer
        self.quarantine_dir = quarantine_dir

    def _is_critical(self, path: str) -> bool:
        rp = os.path.realpath(path)
        return rp in CRITICAL_DELETE_PATHS

    def execute(
        self,
        paths: list[str],
        mode: str,
        policy: CleanupPolicy,
        allowed_roots: list[str],
    ) -> dict[str, Any]:
        action_id = f"{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        details = {
            "mode": mode,
            "allowed_roots": allowed_roots,
            "quarantine_mode": policy.quarantine_mode,
            "dry_run": policy.dry_run,
            "force_high_risk": policy.force_high_risk,
        }

        self.store.conn.execute(
            "INSERT INTO cleanup_actions(action_id, created_at, snapshot_id, mode, dry_run, details_json) VALUES (?, ?, ?, ?, ?, ?)",
            (action_id, now_utc_iso(), self.snapshot_id, mode, 1 if policy.dry_run else 0, json.dumps(details)),
        )
        self.store.conn.commit()

        results = {
            "action_id": action_id,
            "dry_run": policy.dry_run,
            "quarantine_mode": policy.quarantine_mode,
            "attempted": 0,
            "deleted_or_quarantined": 0,
            "skipped": 0,
            "failed": 0,
            "estimated_freed_bytes": 0,
            "items": [],
        }

        roots = [os.path.realpath(r) for r in allowed_roots]

        for p in paths:
            rp = os.path.realpath(p)
            results["attempted"] += 1

            if not any(is_subpath(rp, root) for root in roots):
                self._record_cleanup_item(action_id, rp, "skipped", "high", 100, "outside_allowed_roots")
                results["skipped"] += 1
                continue

            if self._is_critical(rp):
                self._record_cleanup_item(action_id, rp, "skipped", "high", 100, "critical_path_protection")
                results["skipped"] += 1
                continue

            row = self.store.conn.execute(
                "SELECT size, extension, is_hidden, category FROM files WHERE snapshot_id=? AND path=? LIMIT 1",
                (self.snapshot_id, rp),
            ).fetchone()
            size = int(row["size"]) if row else 0
            ext = str(row["extension"]) if row else Path(rp).suffix.lower()
            is_hidden = bool(row["is_hidden"]) if row else os.path.basename(rp).startswith(".")
            category = str(row["category"]) if row else self.classifier.classify(rp, ext)

            risk = self.risk_scorer.assess(rp, category, is_hidden)

            if risk.level == "high" and not policy.force_high_risk:
                self._record_cleanup_item(action_id, rp, "skipped", risk.level, risk.score, "high_risk_requires_force")
                results["skipped"] += 1
                continue

            if policy.dry_run:
                self._record_cleanup_item(action_id, rp, "dry-run", risk.level, risk.score, ";".join(risk.reasons))
                results["deleted_or_quarantined"] += 1
                results["estimated_freed_bytes"] += size
                continue

            try:
                quarantine_path = None
                if policy.quarantine_mode:
                    quarantine_path = self._move_to_quarantine(action_id, rp)
                    self.store.conn.execute(
                        "INSERT INTO quarantine_manifest(action_id, original_path, quarantine_path) VALUES (?, ?, ?)",
                        (action_id, rp, quarantine_path),
                    )
                    self._record_cleanup_item(
                        action_id,
                        rp,
                        "quarantined",
                        risk.level,
                        risk.score,
                        ";".join(risk.reasons),
                        quarantine_path=quarantine_path,
                    )
                else:
                    self._delete_permanently(rp)
                    self._record_cleanup_item(action_id, rp, "deleted", risk.level, risk.score, ";".join(risk.reasons))

                results["deleted_or_quarantined"] += 1
                results["estimated_freed_bytes"] += size
                self.logger.info("cleanup_success action=%s path=%s risk=%s", action_id, rp, risk.level)
            except Exception as exc:  # pylint: disable=broad-except
                self._record_cleanup_item(action_id, rp, "failed", risk.level, risk.score, ";".join(risk.reasons), error=str(exc))
                results["failed"] += 1
                self.logger.error("cleanup_failed action=%s path=%s err=%s", action_id, rp, exc)

        self.store.conn.commit()
        results["estimated_freed_human"] = human_bytes(int(results["estimated_freed_bytes"]))
        return results

    def _record_cleanup_item(
        self,
        action_id: str,
        path: str,
        status: str,
        risk_level: str,
        risk_score: int,
        reason: str,
        quarantine_path: str | None = None,
        error: str | None = None,
    ) -> None:
        self.store.conn.execute(
            """
            INSERT INTO cleanup_items(action_id, path, status, risk_level, risk_score, reason, quarantine_path, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (action_id, path, status, risk_level, risk_score, reason, quarantine_path, error),
        )

    def _move_to_quarantine(self, action_id: str, original_path: str) -> str:
        rp = os.path.realpath(original_path)
        rel = rp.lstrip("/")
        target = self.quarantine_dir / action_id / rel
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            target = Path("/tmp") / APP_NAME / "quarantine" / action_id / rel
            target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(rp, str(target))
        return str(target)

    def _delete_permanently(self, path: str) -> None:
        p = Path(path)
        if p.is_symlink() or p.is_file():
            p.unlink(missing_ok=True)
        elif p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink(missing_ok=True)

    def undo(self, action_id: str) -> dict[str, Any]:
        rows = self.store.conn.execute(
            """
            SELECT id, original_path, quarantine_path, restored_at
            FROM quarantine_manifest
            WHERE action_id=?
            """,
            (action_id,),
        ).fetchall()
        if not rows:
            return {
                "action_id": action_id,
                "restored": 0,
                "failed": 0,
                "message": "No quarantine records found for action.",
            }

        restored = 0
        failed = 0
        failures = []

        for r in rows:
            if r["restored_at"]:
                continue
            orig = Path(r["original_path"])
            qpath = Path(r["quarantine_path"])
            try:
                if not qpath.exists():
                    raise FileNotFoundError(f"Quarantine path missing: {qpath}")
                orig.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(qpath), str(orig))
                self.store.conn.execute(
                    "UPDATE quarantine_manifest SET restored_at=? WHERE id=?",
                    (now_utc_iso(), int(r["id"])),
                )
                restored += 1
            except Exception as exc:  # pylint: disable=broad-except
                failed += 1
                failures.append({"original": str(orig), "quarantine": str(qpath), "error": str(exc)})

        self.store.conn.commit()
        return {
            "action_id": action_id,
            "restored": restored,
            "failed": failed,
            "failures": failures,
        }


# ----------------------------- Visual Reporting ----------------------------- #


class VisualReporter:
    """Generate charts for distribution, folder usage, growth, and duplicates."""

    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _import_matplotlib(self):
        try:
            import matplotlib.pyplot as plt
            return plt
        except Exception as exc:  # pylint: disable=broad-except
            raise RuntimeError(
                "matplotlib is required for visualize mode. Install with: pip install matplotlib"
            ) from exc

    def chart_type_pie(self, type_dist: list[dict[str, Any]]) -> str:
        plt = self._import_matplotlib()
        labels = [x["category"] for x in type_dist if x["bytes"] > 0]
        values = [x["bytes"] for x in type_dist if x["bytes"] > 0]
        if not values:
            return ""
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.pie(values, labels=labels, autopct="%1.1f%%", startangle=140)
        ax.set_title("Disk Usage by File Type")
        out = self.output_dir / "type_distribution_pie.png"
        fig.tight_layout()
        fig.savefig(out, dpi=150)
        plt.close(fig)
        return str(out)

    def chart_folder_bar(self, folders: list[dict[str, Any]], top_n: int = 15) -> str:
        plt = self._import_matplotlib()
        data = folders[:top_n]
        if not data:
            return ""
        labels = [Path(x["folder"]).name or x["folder"] for x in data]
        values = [x["bytes"] / (1024 ** 3) for x in data]
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.bar(labels, values)
        ax.set_title("Largest Folders (GB)")
        ax.set_ylabel("GB")
        ax.tick_params(axis="x", labelrotation=30)
        out = self.output_dir / "largest_folders_bar.png"
        fig.tight_layout()
        fig.savefig(out, dpi=150)
        plt.close(fig)
        return str(out)

    def chart_growth_timeseries(self, history: list[dict[str, Any]]) -> str:
        plt = self._import_matplotlib()
        if len(history) < 2:
            return ""
        x = [dt.datetime.fromisoformat(h["created_at"]) for h in history]
        y = [h["total_bytes"] / (1024 ** 3) for h in history]
        fig, ax = plt.subplots(figsize=(12, 5))
        ax.plot(x, y, marker="o")
        ax.set_title("Storage Growth Over Time")
        ax.set_ylabel("Total Size (GB)")
        ax.grid(True, alpha=0.3)
        out = self.output_dir / "growth_timeseries.png"
        fig.tight_layout()
        fig.savefig(out, dpi=150)
        plt.close(fig)
        return str(out)

    def chart_duplicate_clusters(self, dup_report: dict[str, Any], top_n: int = 15) -> str:
        plt = self._import_matplotlib()
        clusters = dup_report.get("clusters", [])[:top_n]
        if not clusters:
            return ""
        labels = [c["cluster_id"] for c in clusters]
        values = [c["potential_waste"] / (1024 ** 2) for c in clusters]
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.bar(labels, values)
        ax.set_title("Duplicate Cluster Waste (MB)")
        ax.set_ylabel("Waste (MB)")
        ax.tick_params(axis="x", labelrotation=45)
        out = self.output_dir / "duplicate_clusters_bar.png"
        fig.tight_layout()
        fig.savefig(out, dpi=150)
        plt.close(fig)
        return str(out)


# ------------------------------- Orchestrator ------------------------------- #


class Engine:
    """Top-level orchestrator for scan/analyze/cleanup/report flows."""

    def __init__(
        self,
        db_path: Path,
        classifier_rule_file: str | None = None,
        log_file: Path = DEFAULT_LOG_FILE,
    ):
        self.logger = setup_logger(log_file)
        try:
            self.store = SnapshotStore(db_path)
        except OSError as exc:
            fallback_db = Path("/tmp") / APP_NAME / "disk_intel.db"
            self.logger.warning("db_path_unavailable path=%s err=%s fallback=%s", db_path, exc, fallback_db)
            self.store = SnapshotStore(fallback_db)
        self.classifier = FileClassifier(custom_rule_file=classifier_rule_file)
        self.risk = RiskScorer()

    def close(self) -> None:
        self.store.close()

    def scan(self, roots: list[str], follow_symlinks: bool = False, include_hidden: bool = True) -> dict[str, Any]:
        cfg = ScanConfig(roots=roots, follow_symlinks=follow_symlinks, include_hidden=include_hidden)
        snapshot_id = self.store.create_snapshot(roots)
        scanner = FileScanner(cfg, self.classifier)
        result = scanner.scan_to_store(self.store, snapshot_id)
        self.logger.info("scan_complete snapshot=%s files=%s bytes=%s", snapshot_id, result["total_files"], result["total_bytes"])
        return result

    def analyze_snapshot(self, snapshot_id: int, top_n: int = 50, include_duplicates: bool = True) -> dict[str, Any]:
        analyzer = DiskAnalyzer(self.store, snapshot_id)
        summary = analyzer.summary()

        report: dict[str, Any] = {
            "mode": "analyze",
            "generated_at": now_utc_iso(),
            "summary": summary,
            "largest_files": analyzer.largest_files(limit=top_n),
            "folder_sizes": analyzer.folder_sizes(limit=top_n),
            "type_distribution": analyzer.type_distribution(),
            "extension_frequency": analyzer.extension_frequency(limit=top_n),
            "pareto": analyzer.pareto_top_consumers(),
            "size_histogram": analyzer.size_histogram(),
            "growth": analyzer.growth_compare_previous(),
            "growth_prediction": analyzer.predict_disk_fill(),
            "carbon_estimation": CarbonEstimator.estimate(summary["total_bytes"]),
        }

        if include_duplicates:
            det = DuplicateDetector(self.store, snapshot_id)
            report["duplicates"] = det.find_duplicates()

        return report

    def get_snapshot_id(self, requested: int | None = None) -> int:
        if requested is not None:
            return requested
        latest = self.store.latest_snapshot()
        if latest is None:
            raise ValueError("No snapshots available. Run analyze/scan first.")
        return latest


# -------------------------------- CLI -------------------------------------- #


def export_json(path: Path, obj: Any) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=True), encoding="utf-8")


def require_confirm(args: argparse.Namespace, message: str) -> bool:
    if getattr(args, "yes", False):
        return True
    ans = input(f"{message} [y/N]: ").strip().lower()
    return ans in {"y", "yes"}


def collect_cleanup_candidates(
    engine: Engine,
    snapshot_id: int,
    mode: str,
    args: argparse.Namespace,
) -> list[str]:
    analyzer = DiskAnalyzer(engine.store, snapshot_id)

    if mode == "duplicates":
        dup = DuplicateDetector(engine.store, snapshot_id).find_duplicates()
        paths = []
        for c in dup.get("clusters", []):
            paths.extend(c.get("remove_paths", []))
        return list(dict.fromkeys(paths))

    if mode == "large-old":
        min_size = parse_size_to_bytes(args.min_size)
        old_days = int(args.days)
        items = analyzer.large_and_old_files(min_size=min_size, older_than_days=old_days, limit=args.limit)
        return [i["path"] for i in items]

    if mode == "logs-temp":
        rows = engine.store.conn.execute(
            """
            SELECT path FROM files
            WHERE snapshot_id=? AND (
              extension IN ('.log', '.tmp', '.cache', '.trace', '.out', '.err')
              OR path LIKE '%/tmp/%' OR path LIKE '%/cache/%' OR path LIKE '%/var/tmp/%'
            )
            ORDER BY size DESC
            LIMIT ?
            """,
            (snapshot_id, args.limit),
        ).fetchall()
        return [r["path"] for r in rows]

    if mode == "path-list":
        if not args.path_list:
            raise ValueError("--path-list is required for clean mode path-list")
        p = Path(args.path_list)
        if not p.exists():
            raise FileNotFoundError(f"Path list file not found: {p}")
        return [line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]

    raise ValueError(f"Unsupported cleanup mode: {mode}")


def command_analyze(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    scan = engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
    snapshot_id = int(scan["snapshot_id"])
    report = engine.analyze_snapshot(snapshot_id, top_n=args.top_n, include_duplicates=not args.no_duplicates)
    report["scan"] = scan
    return report


def command_duplicates(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        scan = engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
        snapshot_id = int(scan["snapshot_id"])
    else:
        snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    det = DuplicateDetector(engine.store, snapshot_id)
    report = det.find_duplicates()
    report["snapshot_id"] = snapshot_id
    report["mode"] = "duplicates"
    report["generated_at"] = now_utc_iso()
    return report


def command_large(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        scan = engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
        snapshot_id = int(scan["snapshot_id"])
    else:
        snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    min_size = parse_size_to_bytes(args.min_size)
    items = analyzer.large_files(min_size=min_size, limit=args.limit)
    return {
        "mode": "large",
        "snapshot_id": snapshot_id,
        "threshold_bytes": min_size,
        "threshold_human": human_bytes(min_size),
        "count": len(items),
        "items": items,
    }


def command_old(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        scan = engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
        snapshot_id = int(scan["snapshot_id"])
    else:
        snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    items = analyzer.old_files(older_than_days=args.days, limit=args.limit)
    return {
        "mode": "old",
        "snapshot_id": snapshot_id,
        "older_than_days": args.days,
        "count": len(items),
        "items": items,
    }


def command_growth(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
    snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    return {
        "mode": "growth",
        "snapshot_id": snapshot_id,
        "history": analyzer.growth_history(),
        "comparison": analyzer.growth_compare_previous(),
        "prediction": analyzer.predict_disk_fill(),
    }


def command_carbon(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
    snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    total = analyzer.summary()["total_bytes"]
    return {
        "mode": "carbon",
        "snapshot_id": snapshot_id,
        "estimation": CarbonEstimator.estimate(total),
    }


def command_dev_clean(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
    snapshot_id = engine.get_snapshot_id(args.snapshot_id)
    analyzer = DevWasteAnalyzer(engine.store, snapshot_id)
    return {
        "mode": "dev-clean",
        "snapshot_id": snapshot_id,
        "generated_at": now_utc_iso(),
        "analysis": analyzer.analyze(),
        "note": "Suggestions only. No deletion performed.",
    }


def command_clean(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)

    snapshot_id = engine.get_snapshot_id(args.snapshot_id)

    if args.mode == "path-list" and not args.path_list:
        raise ValueError("--path-list is required when clean mode is path-list")

    candidates = collect_cleanup_candidates(engine, snapshot_id, args.mode, args)

    policy = CleanupPolicy(
        dry_run=not args.execute,
        force_high_risk=args.force_high_risk,
        quarantine_mode=not args.no_quarantine,
        confirm=args.confirm,
    )

    allowed_roots = [os.path.realpath(os.path.expanduser(r)) for r in args.roots]

    if not policy.dry_run:
        if not args.confirm:
            raise ValueError("Destructive mode requires --confirm")
        if not require_confirm(args, f"Proceed with cleanup of up to {len(candidates)} items?"):
            return {
                "mode": "clean",
                "snapshot_id": snapshot_id,
                "status": "cancelled",
                "candidate_count": len(candidates),
            }

    cleaner = CleanupEngine(
        store=engine.store,
        snapshot_id=snapshot_id,
        logger=engine.logger,
        classifier=engine.classifier,
        risk_scorer=engine.risk,
        quarantine_dir=Path(args.quarantine_dir),
    )

    result = cleaner.execute(paths=candidates, mode=args.mode, policy=policy, allowed_roots=allowed_roots)
    result["mode"] = "clean"
    result["snapshot_id"] = snapshot_id
    result["candidate_count"] = len(candidates)
    return result


def command_undo(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    snapshot_id = engine.get_snapshot_id(args.snapshot_id) if args.snapshot_id else (engine.store.latest_snapshot() or 0)
    cleaner = CleanupEngine(
        store=engine.store,
        snapshot_id=snapshot_id,
        logger=engine.logger,
        classifier=engine.classifier,
        risk_scorer=engine.risk,
        quarantine_dir=Path(args.quarantine_dir),
    )
    if not args.action_id:
        raise ValueError("--action-id is required for undo")
    if not require_confirm(args, f"Restore quarantined files for action {args.action_id}?"):
        return {"mode": "undo", "status": "cancelled"}
    result = cleaner.undo(args.action_id)
    result["mode"] = "undo"
    return result


def command_visualize(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    if args.scan:
        engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=not args.no_hidden)
    snapshot_id = engine.get_snapshot_id(args.snapshot_id)

    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    reporter = VisualReporter(Path(args.output_dir))

    type_dist = analyzer.type_distribution()
    folders = analyzer.folder_sizes(limit=max(30, args.top_n))
    history = analyzer.growth_history()
    dup = DuplicateDetector(engine.store, snapshot_id).find_duplicates() if args.include_duplicates else {"clusters": []}

    files = {
        "type_pie": reporter.chart_type_pie(type_dist),
        "folder_bar": reporter.chart_folder_bar(folders, top_n=args.top_n),
        "growth_timeseries": reporter.chart_growth_timeseries(history),
        "duplicates_bar": reporter.chart_duplicate_clusters(dup, top_n=args.top_n),
    }

    return {
        "mode": "visualize",
        "snapshot_id": snapshot_id,
        "output_dir": str(Path(args.output_dir).resolve()),
        "chart_files": files,
    }


def command_forensics(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    scan = engine.scan(args.roots, follow_symlinks=args.follow_symlinks, include_hidden=True)
    snapshot_id = int(scan["snapshot_id"])

    analyzer = DiskAnalyzer(engine.store, snapshot_id)
    report = {
        "mode": "forensics",
        "read_only": True,
        "generated_at": now_utc_iso(),
        "scan": scan,
        "summary": analyzer.summary(),
        "largest_files": analyzer.largest_files(limit=args.top_n),
        "folder_sizes": analyzer.folder_sizes(limit=args.top_n),
        "type_distribution": analyzer.type_distribution(),
        "extension_frequency": analyzer.extension_frequency(limit=args.top_n),
        "size_histogram": analyzer.size_histogram(),
        "growth": analyzer.growth_compare_previous(),
        "growth_history": analyzer.growth_history(),
        "growth_prediction": analyzer.predict_disk_fill(),
        "carbon_estimation": CarbonEstimator.estimate(analyzer.summary()["total_bytes"]),
        "duplicates": DuplicateDetector(engine.store, snapshot_id).find_duplicates(),
        "dev_waste": DevWasteAnalyzer(engine.store, snapshot_id).analyze(),
        "cleanup_policy": {
            "deletion_performed": False,
            "note": "Forensics mode is strictly read-only.",
        },
    }
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="disk-intel",
        description="Disk Intelligence and Cleanup Engine (Linux)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database path")
    parser.add_argument("--classifier-rules", default=None, help="Custom classification JSON rule file")
    parser.add_argument("--log-file", default=str(DEFAULT_LOG_FILE), help="Action log file")

    sub = parser.add_subparsers(dest="command", required=True)

    def add_scan_opts(p: argparse.ArgumentParser) -> None:
        p.add_argument("--roots", nargs="+", default=[str(Path.cwd())], help="Root paths to scan")
        p.add_argument("--scan", action="store_true", help="Create a new snapshot before this command")
        p.add_argument("--snapshot-id", type=int, default=None, help="Use specific snapshot ID")
        p.add_argument("--follow-symlinks", action="store_true", help="Follow symlink directories")
        p.add_argument("--no-hidden", action="store_true", help="Skip hidden files during scan")

    # analyze
    p = sub.add_parser("analyze", help="Full scan + disk usage analysis")
    p.add_argument("--roots", nargs="+", default=[str(Path.cwd())])
    p.add_argument("--top-n", type=int, default=50)
    p.add_argument("--follow-symlinks", action="store_true")
    p.add_argument("--no-hidden", action="store_true")
    p.add_argument("--no-duplicates", action="store_true")
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "analyze_report.json"))

    # duplicates
    p = sub.add_parser("duplicates", help="Duplicate file analysis")
    add_scan_opts(p)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "duplicates_report.json"))

    # large
    p = sub.add_parser("large", help="Find large files")
    add_scan_opts(p)
    p.add_argument("--min-size", default="500MB", help="Threshold size, e.g. 500MB")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "large_files_report.json"))

    # old
    p = sub.add_parser("old", help="Find old files")
    add_scan_opts(p)
    p.add_argument("--days", type=int, default=180)
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "old_files_report.json"))

    # growth
    p = sub.add_parser("growth", help="Growth and churn analysis")
    add_scan_opts(p)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "growth_report.json"))

    # carbon
    p = sub.add_parser("carbon", help="Estimate storage carbon impact")
    add_scan_opts(p)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "carbon_report.json"))

    # dev-clean (suggestions)
    p = sub.add_parser("dev-clean", help="Analyze development environment waste (suggestions only)")
    add_scan_opts(p)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "dev_waste_report.json"))

    # clean
    p = sub.add_parser("clean", help="Risk-scored cleanup with dry-run default")
    p.add_argument("--roots", nargs="+", default=[str(Path.cwd())], help="Allowed roots for cleanup")
    p.add_argument("--scan", action="store_true", help="Create snapshot before cleanup candidate selection")
    p.add_argument("--snapshot-id", type=int, default=None)
    p.add_argument("--follow-symlinks", action="store_true")
    p.add_argument("--no-hidden", action="store_true")
    p.add_argument("--mode", choices=["duplicates", "large-old", "logs-temp", "path-list"], default="large-old")
    p.add_argument("--min-size", default="1GB", help="Used for large-old mode")
    p.add_argument("--days", type=int, default=180, help="Used for large-old mode")
    p.add_argument("--limit", type=int, default=2000)
    p.add_argument("--path-list", default=None, help="Path list file for path-list mode")
    p.add_argument("--execute", action="store_true", help="Actually perform cleanup (otherwise dry-run)")
    p.add_argument("--confirm", action="store_true", help="Required for destructive execution")
    p.add_argument("--yes", action="store_true", help="Non-interactive yes for confirmations")
    p.add_argument("--force-high-risk", action="store_true", help="Allow high-risk deletions")
    p.add_argument("--no-quarantine", action="store_true", help="Delete permanently instead of quarantine")
    p.add_argument("--quarantine-dir", default=str(DEFAULT_QUARANTINE_DIR))
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "cleanup_report.json"))

    # undo
    p = sub.add_parser("undo", help="Undo a quarantine cleanup action")
    p.add_argument("--snapshot-id", type=int, default=None)
    p.add_argument("--action-id", required=True)
    p.add_argument("--quarantine-dir", default=str(DEFAULT_QUARANTINE_DIR))
    p.add_argument("--yes", action="store_true")
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "undo_report.json"))

    # visualize
    p = sub.add_parser("visualize", help="Generate visual report charts")
    add_scan_opts(p)
    p.add_argument("--output-dir", default=str(DEFAULT_EXPORT_DIR / "visuals"))
    p.add_argument("--include-duplicates", action="store_true")
    p.add_argument("--top-n", type=int, default=15)
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "visualize_report.json"))

    # forensics
    p = sub.add_parser("forensics", help="Read-only full audit report")
    p.add_argument("--roots", nargs="+", default=[str(Path.cwd())])
    p.add_argument("--top-n", type=int, default=100)
    p.add_argument("--follow-symlinks", action="store_true")
    p.add_argument("--output", default=str(DEFAULT_EXPORT_DIR / "forensics_report.json"))

    return parser


def dispatch(engine: Engine, args: argparse.Namespace) -> dict[str, Any]:
    cmd = args.command
    if cmd == "analyze":
        return command_analyze(engine, args)
    if cmd == "duplicates":
        return command_duplicates(engine, args)
    if cmd == "large":
        return command_large(engine, args)
    if cmd == "old":
        return command_old(engine, args)
    if cmd == "growth":
        return command_growth(engine, args)
    if cmd == "carbon":
        return command_carbon(engine, args)
    if cmd == "dev-clean":
        return command_dev_clean(engine, args)
    if cmd == "clean":
        return command_clean(engine, args)
    if cmd == "undo":
        return command_undo(engine, args)
    if cmd == "visualize":
        return command_visualize(engine, args)
    if cmd == "forensics":
        return command_forensics(engine, args)
    raise ValueError(f"Unknown command: {cmd}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    engine = Engine(
        db_path=Path(args.db),
        classifier_rule_file=args.classifier_rules,
        log_file=Path(args.log_file),
    )

    try:
        result = dispatch(engine, args)
        output_path = Path(args.output)
        export_json(output_path, result)

        print(json.dumps({
            "status": "ok",
            "command": args.command,
            "output": str(output_path.resolve()),
            "timestamp": now_utc_iso(),
        }, indent=2))
        return 0
    except Exception as exc:  # pylint: disable=broad-except
        print(json.dumps({
            "status": "error",
            "command": getattr(args, "command", None),
            "error": str(exc),
            "timestamp": now_utc_iso(),
        }, indent=2), file=sys.stderr)
        return 1
    finally:
        engine.close()


if __name__ == "__main__":
    raise SystemExit(main())
