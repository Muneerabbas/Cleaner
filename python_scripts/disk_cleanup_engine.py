#!/usr/bin/env python3
"""Core engine for disk analysis, cleanup planning, and cleanup execution.

This module is intentionally standalone and standard-library only.
It provides:
- High-volume file scanning with exclusion controls
- Detailed storage analysis and duplicate detection
- Cleanup plan generation with transparent reasons
- Safe execution with dry-run by default and root-bound protections
"""

from __future__ import annotations

import datetime as dt
import fnmatch
import hashlib
import json
import os
import shutil
import stat
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence


DEFAULT_EXCLUDE_DIR_NAMES = {
    ".git",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
    ".gradle",
    ".kotlin",
    ".expo",
    ".DS_Store",
    "venv",
    ".venv",
    "dist",
    "build",
}

DEFAULT_EXCLUDE_GLOBS = [
    "*/.git/*",
    "*/node_modules/*",
    "*/__pycache__/*",
    "*/.venv/*",
    "*/venv/*",
]

TEMP_EXTENSIONS = {
    ".tmp",
    ".temp",
    ".bak",
    ".old",
    ".cache",
    ".dmp",
    ".crdownload",
    ".part",
}

LOG_EXTENSIONS = {
    ".log",
    ".trace",
    ".err",
    ".out",
}

NOISE_FILENAMES = {
    "thumbs.db",
    ".ds_store",
    "desktop.ini",
}

CACHE_DIR_HINTS = {
    "cache",
    "caches",
    "tmp",
    "temp",
}

PROTECTED_ABSOLUTE_PATHS = {
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
    "/srv",
    "/sys",
    "/usr",
    "/var",
}


@dataclass
class FileRecord:
    """Metadata for one discovered file."""

    path: str
    size: int
    mtime: float
    atime: float
    extension: str
    name: str
    is_hidden: bool


@dataclass
class ScanError:
    """An error observed while scanning."""

    path: str
    error: str


@dataclass
class AnalyzerConfig:
    """Controls scanning and analysis behavior."""

    roots: list[str]
    exclude_globs: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE_GLOBS))
    exclude_dir_names: set[str] = field(default_factory=lambda: set(DEFAULT_EXCLUDE_DIR_NAMES))
    include_hidden: bool = False
    follow_symlinks: bool = False
    min_file_size_bytes: int = 1
    stale_days: int = 120
    top_n: int = 50
    include_duplicates: bool = True
    quick_hash_bytes: int = 1024 * 1024
    max_duplicate_candidates: int = 200_000


@dataclass
class CleanupPolicy:
    """Policy used by the plan builder to select cleanup candidates."""

    temp_min_age_days: int = 3
    log_min_age_days: int = 14
    stale_min_age_days: int = 180
    stale_min_size_bytes: int = 200 * 1024 * 1024
    include_empty_dirs: bool = True
    max_actions: int = 20_000


@dataclass
class CleanupAction:
    """One proposed cleanup operation."""

    path: str
    reason: str
    category: str
    estimated_bytes: int
    confidence: str


@dataclass
class CleanupPlan:
    """A serializable cleanup plan."""

    created_at_utc: str
    roots: list[str]
    policy: dict[str, Any]
    actions: list[CleanupAction]
    notes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "created_at_utc": self.created_at_utc,
            "roots": self.roots,
            "policy": self.policy,
            "actions": [asdict(a) for a in self.actions],
            "notes": self.notes,
        }


@dataclass
class ExecutionResult:
    """Execution summary for cleanup actions."""

    dry_run: bool
    used_trash: bool
    attempted: int
    deleted: int
    failed: int
    skipped: int
    estimated_freed_bytes: int
    deleted_paths: list[str]
    failed_items: list[dict[str, str]]
    skipped_items: list[dict[str, str]]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def now_utc_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def parse_bytes_human(value: str) -> int:
    """Parse values like 500MB, 2GB, 1024 into bytes."""
    text = value.strip().lower().replace(" ", "")
    units = {
        "kb": 1024,
        "mb": 1024 ** 2,
        "gb": 1024 ** 3,
        "tb": 1024 ** 4,
        "b": 1,
    }
    for suffix, factor in units.items():
        if text.endswith(suffix):
            number = float(text[: -len(suffix)] or "0")
            return int(number * factor)
    return int(float(text))


def format_bytes(value: int) -> str:
    """Human-readable bytes using binary units."""
    num = float(max(0, value))
    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if num < 1024.0 or unit == "PB":
            if unit == "B":
                return f"{int(num)} {unit}"
            return f"{num:.2f} {unit}"
        num /= 1024.0
    return f"{int(value)} B"


def age_days(epoch_seconds: float, now: float | None = None) -> int:
    now_ts = now if now is not None else dt.datetime.now().timestamp()
    if epoch_seconds <= 0:
        return 0
    return max(0, int((now_ts - epoch_seconds) // 86400))


def write_json(path: str | Path, data: Any) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=True), encoding="utf-8")


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


class DiskAnalyzer:
    """Scan one or more roots and produce detailed storage analytics."""

    def __init__(self, config: AnalyzerConfig):
        self.config = config
        self.errors: list[ScanError] = []
        self._dir_sizes: Counter[str] = Counter()

    def scan(self) -> list[FileRecord]:
        records: list[FileRecord] = []
        self.errors = []
        self._dir_sizes = Counter()

        roots = [self._normalize_root(r) for r in self.config.roots]
        roots = [r for r in roots if r.exists() and r.is_dir()]

        for root in roots:
            for rec in self._scan_root(root):
                records.append(rec)

        return records

    def build_report(self, records: Sequence[FileRecord]) -> dict[str, Any]:
        now_ts = dt.datetime.now().timestamp()
        total_files = len(records)
        total_bytes = sum(r.size for r in records)

        by_extension = Counter()
        by_extension_bytes = Counter()
        for rec in records:
            ext = rec.extension or "(no_ext)"
            by_extension[ext] += 1
            by_extension_bytes[ext] += rec.size

        top_extensions = []
        for ext, count in by_extension.most_common(self.config.top_n):
            top_extensions.append(
                {
                    "extension": ext,
                    "files": count,
                    "bytes": by_extension_bytes[ext],
                    "bytes_human": format_bytes(by_extension_bytes[ext]),
                }
            )

        age_buckets = {
            "0_7_days": 0,
            "8_30_days": 0,
            "31_90_days": 0,
            "91_180_days": 0,
            "181_365_days": 0,
            "366_plus_days": 0,
        }

        for rec in records:
            days = age_days(rec.mtime, now_ts)
            if days <= 7:
                age_buckets["0_7_days"] += 1
            elif days <= 30:
                age_buckets["8_30_days"] += 1
            elif days <= 90:
                age_buckets["31_90_days"] += 1
            elif days <= 180:
                age_buckets["91_180_days"] += 1
            elif days <= 365:
                age_buckets["181_365_days"] += 1
            else:
                age_buckets["366_plus_days"] += 1

        largest_files = [
            {
                "path": r.path,
                "size": r.size,
                "size_human": format_bytes(r.size),
                "mtime": dt.datetime.fromtimestamp(r.mtime).isoformat(),
                "atime": dt.datetime.fromtimestamp(r.atime).isoformat(),
            }
            for r in sorted(records, key=lambda x: x.size, reverse=True)[: self.config.top_n]
        ]

        stale_cutoff = self.config.stale_days
        stale_files = [
            {
                "path": r.path,
                "size": r.size,
                "size_human": format_bytes(r.size),
                "days_since_access": age_days(r.atime, now_ts),
            }
            for r in records
            if age_days(r.atime, now_ts) >= stale_cutoff
        ]
        stale_files.sort(key=lambda x: x["size"], reverse=True)

        dir_summary = [
            {
                "directory": path,
                "bytes": size,
                "bytes_human": format_bytes(size),
            }
            for path, size in self._dir_sizes.most_common(self.config.top_n)
        ]

        duplicate_groups: list[dict[str, Any]] = []
        duplicate_file_count = 0
        duplicate_waste_bytes = 0

        if self.config.include_duplicates:
            groups = self.find_duplicate_groups(records)
            for group in groups:
                if len(group) <= 1:
                    continue
                size = group[0].size
                duplicate_file_count += len(group)
                duplicate_waste_bytes += size * (len(group) - 1)
                duplicate_groups.append(
                    {
                        "file_count": len(group),
                        "size_each": size,
                        "size_each_human": format_bytes(size),
                        "potential_waste_bytes": size * (len(group) - 1),
                        "potential_waste_human": format_bytes(size * (len(group) - 1)),
                        "paths": [g.path for g in group],
                    }
                )

        report = {
            "generated_at_utc": now_utc_iso(),
            "scan_config": {
                "roots": self.config.roots,
                "exclude_globs": self.config.exclude_globs,
                "exclude_dir_names": sorted(self.config.exclude_dir_names),
                "include_hidden": self.config.include_hidden,
                "follow_symlinks": self.config.follow_symlinks,
                "min_file_size_bytes": self.config.min_file_size_bytes,
                "stale_days": self.config.stale_days,
                "top_n": self.config.top_n,
                "include_duplicates": self.config.include_duplicates,
            },
            "summary": {
                "total_files": total_files,
                "total_bytes": total_bytes,
                "total_human": format_bytes(total_bytes),
                "hidden_files": sum(1 for r in records if r.is_hidden),
                "scan_errors": len(self.errors),
            },
            "age_buckets": age_buckets,
            "top_extensions": top_extensions,
            "top_directories": dir_summary,
            "largest_files": largest_files,
            "stale_files_top": stale_files[: self.config.top_n],
            "duplicates": {
                "group_count": len(duplicate_groups),
                "files_in_groups": duplicate_file_count,
                "potential_waste_bytes": duplicate_waste_bytes,
                "potential_waste_human": format_bytes(duplicate_waste_bytes),
                "groups": duplicate_groups[: self.config.top_n],
            },
            "errors": [asdict(e) for e in self.errors[: self.config.top_n * 2]],
        }
        return report

    def render_markdown_report(self, report: dict[str, Any]) -> str:
        lines: list[str] = []
        lines.append("# Disk Analysis Report")
        lines.append("")
        lines.append(f"Generated: `{report['generated_at_utc']}`")
        lines.append("")

        summary = report["summary"]
        lines.append("## Summary")
        lines.append(f"- Total files: **{summary['total_files']}**")
        lines.append(f"- Total size: **{summary['total_human']}** ({summary['total_bytes']} bytes)")
        lines.append(f"- Hidden files: **{summary['hidden_files']}**")
        lines.append(f"- Scan errors: **{summary['scan_errors']}**")
        lines.append("")

        lines.append("## Age Buckets")
        for key, val in report["age_buckets"].items():
            lines.append(f"- {key}: {val}")
        lines.append("")

        lines.append("## Top Extensions")
        for item in report["top_extensions"][:20]:
            lines.append(
                f"- `{item['extension']}`: {item['files']} files, {item['bytes_human']}"
            )
        lines.append("")

        lines.append("## Top Directories")
        for item in report["top_directories"][:20]:
            lines.append(f"- `{item['directory']}`: {item['bytes_human']}")
        lines.append("")

        lines.append("## Largest Files")
        for item in report["largest_files"][:20]:
            lines.append(f"- {item['size_human']}: `{item['path']}`")
        lines.append("")

        dup = report["duplicates"]
        lines.append("## Duplicates")
        lines.append(f"- Groups: **{dup['group_count']}**")
        lines.append(f"- Files in groups: **{dup['files_in_groups']}**")
        lines.append(
            f"- Potential waste: **{dup['potential_waste_human']}** ({dup['potential_waste_bytes']} bytes)"
        )
        lines.append("")

        if report["errors"]:
            lines.append("## Sample Errors")
            for item in report["errors"][:20]:
                lines.append(f"- `{item['path']}`: {item['error']}")
            lines.append("")

        return "\n".join(lines)

    def find_duplicate_groups(self, records: Sequence[FileRecord]) -> list[list[FileRecord]]:
        by_size: dict[int, list[FileRecord]] = defaultdict(list)
        for rec in records:
            if rec.size <= 0:
                continue
            by_size[rec.size].append(rec)

        size_candidates = [group for group in by_size.values() if len(group) > 1]
        candidate_count = sum(len(g) for g in size_candidates)
        if candidate_count > self.config.max_duplicate_candidates:
            size_candidates = sorted(size_candidates, key=len, reverse=True)
            trimmed: list[list[FileRecord]] = []
            seen = 0
            for group in size_candidates:
                if seen + len(group) > self.config.max_duplicate_candidates:
                    break
                trimmed.append(group)
                seen += len(group)
            size_candidates = trimmed

        quick_hash_groups: dict[tuple[int, str], list[FileRecord]] = defaultdict(list)
        for group in size_candidates:
            for rec in group:
                qh = self._quick_hash(Path(rec.path), self.config.quick_hash_bytes)
                if not qh:
                    continue
                quick_hash_groups[(rec.size, qh)].append(rec)

        full_hash_groups: dict[str, list[FileRecord]] = defaultdict(list)
        for (_, _), group in quick_hash_groups.items():
            if len(group) < 2:
                continue
            for rec in group:
                fh = self._full_hash(Path(rec.path))
                if not fh:
                    continue
                full_hash_groups[fh].append(rec)

        duplicates = [
            sorted(group, key=lambda r: r.path)
            for group in full_hash_groups.values()
            if len(group) > 1
        ]
        duplicates.sort(key=lambda g: (g[0].size, len(g)), reverse=True)
        return duplicates

    def _scan_root(self, root: Path) -> Iterator[FileRecord]:
        stack = [root]
        while stack:
            current = stack.pop()

            if self._is_excluded(current):
                continue

            try:
                with os.scandir(current) as it:
                    for entry in it:
                        entry_path = Path(entry.path)

                        if self._is_excluded(entry_path):
                            continue

                        try:
                            is_dir = entry.is_dir(follow_symlinks=self.config.follow_symlinks)
                            is_file = entry.is_file(follow_symlinks=self.config.follow_symlinks)
                        except (PermissionError, FileNotFoundError, OSError) as exc:
                            self.errors.append(ScanError(path=str(entry_path), error=str(exc)))
                            continue

                        if is_dir:
                            if not self.config.include_hidden and entry.name.startswith("."):
                                continue
                            if entry.name in self.config.exclude_dir_names:
                                continue
                            stack.append(entry_path)
                            continue

                        if not is_file:
                            continue

                        if not self.config.include_hidden and entry.name.startswith("."):
                            continue

                        try:
                            st = entry.stat(follow_symlinks=self.config.follow_symlinks)
                        except (PermissionError, FileNotFoundError, OSError) as exc:
                            self.errors.append(ScanError(path=str(entry_path), error=str(exc)))
                            continue

                        if stat.S_ISLNK(st.st_mode) and not self.config.follow_symlinks:
                            continue

                        if st.st_size < self.config.min_file_size_bytes:
                            continue

                        parent = str(entry_path.parent)
                        self._dir_sizes[parent] += st.st_size

                        yield FileRecord(
                            path=str(entry_path),
                            size=int(st.st_size),
                            mtime=float(st.st_mtime),
                            atime=float(st.st_atime),
                            extension=entry_path.suffix.lower(),
                            name=entry_path.name,
                            is_hidden=entry_path.name.startswith("."),
                        )
            except (PermissionError, FileNotFoundError, OSError) as exc:
                self.errors.append(ScanError(path=str(current), error=str(exc)))

    def _is_excluded(self, path: Path) -> bool:
        p = str(path)
        for pattern in self.config.exclude_globs:
            if fnmatch.fnmatch(p, pattern):
                return True
        if path.name in self.config.exclude_dir_names and path.is_dir():
            return True
        return False

    @staticmethod
    def _normalize_root(path: str) -> Path:
        return Path(path).expanduser().resolve()

    @staticmethod
    def _quick_hash(path: Path, chunk_size: int) -> str | None:
        try:
            size = path.stat().st_size
            hasher = hashlib.sha256()
            with path.open("rb") as fh:
                first = fh.read(chunk_size)
                hasher.update(first)
                if size > chunk_size * 2:
                    fh.seek(max(0, size - chunk_size))
                    hasher.update(fh.read(chunk_size))
            return hasher.hexdigest()
        except (PermissionError, FileNotFoundError, OSError):
            return None

    @staticmethod
    def _full_hash(path: Path, block_size: int = 1024 * 1024) -> str | None:
        try:
            hasher = hashlib.sha256()
            with path.open("rb") as fh:
                while True:
                    chunk = fh.read(block_size)
                    if not chunk:
                        break
                    hasher.update(chunk)
            return hasher.hexdigest()
        except (PermissionError, FileNotFoundError, OSError):
            return None


class CleanupPlanner:
    """Build cleanup actions from scan results and policy rules."""

    def __init__(self, roots: Sequence[str], policy: CleanupPolicy):
        self.roots = [str(Path(r).expanduser().resolve()) for r in roots]
        self.policy = policy

    def build_plan(self, records: Sequence[FileRecord]) -> CleanupPlan:
        now_ts = dt.datetime.now().timestamp()
        actions: list[CleanupAction] = []
        seen_paths: set[str] = set()

        for rec in records:
            path_obj = Path(rec.path)
            ext = rec.extension.lower()
            name_l = rec.name.lower()
            parent_names = {p.lower() for p in path_obj.parts}
            modified_days = age_days(rec.mtime, now_ts)
            access_days = age_days(rec.atime, now_ts)

            # Temporary artifacts
            if ext in TEMP_EXTENSIONS and modified_days >= self.policy.temp_min_age_days:
                self._add_action(
                    actions,
                    seen_paths,
                    rec,
                    reason=(
                        f"Temporary file older than {self.policy.temp_min_age_days} days"
                    ),
                    category="temp_files",
                    confidence="high",
                )
                continue

            # Log artifacts
            if ext in LOG_EXTENSIONS and modified_days >= self.policy.log_min_age_days:
                self._add_action(
                    actions,
                    seen_paths,
                    rec,
                    reason=f"Log file older than {self.policy.log_min_age_days} days",
                    category="old_logs",
                    confidence="high",
                )
                continue

            # Known noisy files
            if name_l in NOISE_FILENAMES:
                self._add_action(
                    actions,
                    seen_paths,
                    rec,
                    reason="Known OS-generated noise file",
                    category="noise_files",
                    confidence="high",
                )
                continue

            # Files under cache/tmp-like directories
            if parent_names.intersection(CACHE_DIR_HINTS) and modified_days >= self.policy.temp_min_age_days:
                self._add_action(
                    actions,
                    seen_paths,
                    rec,
                    reason="File located under cache/tmp-style directory",
                    category="cache_artifacts",
                    confidence="medium",
                )
                continue

            # Very old, very large files with no recent access
            if (
                rec.size >= self.policy.stale_min_size_bytes
                and access_days >= self.policy.stale_min_age_days
            ):
                self._add_action(
                    actions,
                    seen_paths,
                    rec,
                    reason=(
                        f"Large stale file (>{format_bytes(self.policy.stale_min_size_bytes)} and "
                        f"unused for {self.policy.stale_min_age_days}+ days)"
                    ),
                    category="stale_large_files",
                    confidence="medium",
                )

            if len(actions) >= self.policy.max_actions:
                break

        if self.policy.include_empty_dirs and len(actions) < self.policy.max_actions:
            for root in self.roots:
                self._append_empty_directories(root, actions, seen_paths)
                if len(actions) >= self.policy.max_actions:
                    break

        notes = [
            "Plan generation is heuristic-based. Review before execution.",
            "Executor uses dry-run by default.",
            "Actions are root-bound and protected-path checks are enforced.",
            f"Total planned actions: {len(actions)}",
        ]

        return CleanupPlan(
            created_at_utc=now_utc_iso(),
            roots=self.roots,
            policy=asdict(self.policy),
            actions=actions,
            notes=notes,
        )

    @staticmethod
    def _add_action(
        actions: list[CleanupAction],
        seen_paths: set[str],
        record: FileRecord,
        reason: str,
        category: str,
        confidence: str,
    ) -> None:
        if record.path in seen_paths:
            return
        seen_paths.add(record.path)
        actions.append(
            CleanupAction(
                path=record.path,
                reason=reason,
                category=category,
                estimated_bytes=record.size,
                confidence=confidence,
            )
        )

    def _append_empty_directories(
        self,
        root: str,
        actions: list[CleanupAction],
        seen_paths: set[str],
    ) -> None:
        root_path = Path(root)
        if not root_path.exists() or not root_path.is_dir():
            return

        for dirpath, dirnames, filenames in os.walk(root, topdown=False):
            current = Path(dirpath)

            if current.name in DEFAULT_EXCLUDE_DIR_NAMES:
                continue

            if dirnames or filenames:
                continue

            path_s = str(current)
            if path_s in seen_paths:
                continue

            seen_paths.add(path_s)
            actions.append(
                CleanupAction(
                    path=path_s,
                    reason="Empty directory",
                    category="empty_directories",
                    estimated_bytes=0,
                    confidence="high",
                )
            )


class CleanupExecutor:
    """Execute a cleanup plan safely with root/path protections."""

    def __init__(
        self,
        allowed_roots: Sequence[str],
        dry_run: bool = True,
        use_trash: bool = True,
        trash_dir: str | None = None,
    ):
        self.allowed_roots = [
            str(Path(r).expanduser().resolve()) for r in allowed_roots if str(r).strip()
        ]
        self.dry_run = dry_run
        self.use_trash = use_trash
        default_trash = Path.home() / ".local" / "share" / "disk_cleanup_trash"
        self.trash_dir = str(Path(trash_dir).expanduser().resolve()) if trash_dir else str(default_trash)

    def execute_plan(self, plan: CleanupPlan) -> ExecutionResult:
        deleted_paths: list[str] = []
        failed_items: list[dict[str, str]] = []
        skipped_items: list[dict[str, str]] = []
        estimated_freed = 0

        actions = plan.actions

        for action in actions:
            path = Path(action.path).expanduser().resolve()
            path_s = str(path)

            ok, reason = self._is_allowed_target(path_s)
            if not ok:
                skipped_items.append({"path": path_s, "reason": reason})
                continue

            if not path.exists() and not path.is_symlink():
                skipped_items.append({"path": path_s, "reason": "Path does not exist"})
                continue

            if self.dry_run:
                deleted_paths.append(path_s)
                estimated_freed += max(0, action.estimated_bytes)
                continue

            try:
                if self.use_trash:
                    self._move_to_trash(path)
                else:
                    self._delete_path(path)
                deleted_paths.append(path_s)
                estimated_freed += max(0, action.estimated_bytes)
            except Exception as exc:  # pylint: disable=broad-except
                failed_items.append({"path": path_s, "error": str(exc)})

        return ExecutionResult(
            dry_run=self.dry_run,
            used_trash=self.use_trash,
            attempted=len(actions),
            deleted=len(deleted_paths),
            failed=len(failed_items),
            skipped=len(skipped_items),
            estimated_freed_bytes=estimated_freed,
            deleted_paths=deleted_paths,
            failed_items=failed_items,
            skipped_items=skipped_items,
        )

    def _is_allowed_target(self, path: str) -> tuple[bool, str]:
        if path in PROTECTED_ABSOLUTE_PATHS:
            return False, "Protected system path"

        if not self.allowed_roots:
            return False, "No allowed roots configured"

        for root in self.allowed_roots:
            if path == root or path.startswith(root + os.sep):
                return True, "OK"

        return False, "Outside allowed roots"

    def _move_to_trash(self, path: Path) -> None:
        trash_root = Path(self.trash_dir)
        trash_root.mkdir(parents=True, exist_ok=True)

        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        partition = path.anchor.replace(os.sep, "").replace(":", "") or "root"
        relative = Path(*path.parts[1:]) if len(path.parts) > 1 else Path(path.name)

        target = trash_root / timestamp / partition / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists():
            target = target.with_name(target.name + "_dup")

        shutil.move(str(path), str(target))

    def _delete_path(self, path: Path) -> None:
        if path.is_symlink() or path.is_file():
            path.unlink(missing_ok=True)
            return
        if path.is_dir():
            shutil.rmtree(path)
            return
        path.unlink(missing_ok=True)


def plan_from_records(
    roots: Sequence[str],
    records: Sequence[FileRecord],
    policy: CleanupPolicy,
) -> CleanupPlan:
    planner = CleanupPlanner(roots=roots, policy=policy)
    return planner.build_plan(records)


def load_plan(path: str | Path) -> CleanupPlan:
    data = read_json(path)
    actions = [CleanupAction(**a) for a in data.get("actions", [])]
    return CleanupPlan(
        created_at_utc=data.get("created_at_utc", now_utc_iso()),
        roots=data.get("roots", []),
        policy=data.get("policy", {}),
        actions=actions,
        notes=data.get("notes", []),
    )


__all__ = [
    "AnalyzerConfig",
    "CleanupAction",
    "CleanupExecutor",
    "CleanupPlan",
    "CleanupPolicy",
    "DiskAnalyzer",
    "ExecutionResult",
    "FileRecord",
    "format_bytes",
    "load_plan",
    "parse_bytes_human",
    "plan_from_records",
    "read_json",
    "write_json",
]
