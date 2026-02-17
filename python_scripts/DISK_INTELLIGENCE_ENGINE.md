# Disk Intelligence and Cleanup Engine (Linux)

Implementation file:
- `python_scripts/disk_intelligence_engine.py`

## Architecture Overview

The engine is modular inside one Python file, with clear responsibility boundaries:

- `SnapshotStore`:
  - SQLite persistence for snapshots, file metadata, cleanup logs, and quarantine manifests.
  - WAL mode + indexes for large datasets.
- `FileScanner`:
  - Iterative `os.scandir` traversal, batched inserts (`SCAN_BATCH_SIZE`), low memory overhead.
- `DiskAnalyzer`:
  - SQL-backed analytics: folder sizes, largest files, type distribution, extension frequency, Pareto, histogram, growth/churn.
- `DuplicateDetector`:
  - Three-phase pipeline: size grouping -> partial hash -> full SHA-256 verification.
  - Buffered reads, process pool by default, thread-pool fallback when process forking is restricted.
- `DevWasteAnalyzer`:
  - Suggestions for caches, venvs, node_modules, build artifacts, Docker dangling images.
- `RiskScorer`:
  - Risk classification (`low`, `medium`, `high`) before any cleanup.
- `CleanupEngine`:
  - Dry-run default, high-risk guard, root-bound enforcement, quarantine mode, and undo.
- `VisualReporter`:
  - Pie, bar, growth time-series, duplicate cluster charts via matplotlib.
- `CarbonEstimator`:
  - Explicitly approximate energy/CO₂ estimation with assumptions.

## Safety Model

- Default behavior is non-destructive (`clean` is dry-run unless `--execute`).
- Deletion of critical system directories is blocked.
- Cleanup is restricted to explicitly provided `--roots`.
- High-risk items are skipped unless `--force-high-risk`.
- Destructive run requires `--confirm`, and optionally `--yes` for non-interactive usage.
- Quarantine mode is enabled by default; undo is supported via action ID.

## Performance Design

- Efficient directory traversal with `os.scandir` and iterative stack.
- Batched database writes to reduce transaction overhead.
- SQL aggregation for analysis to avoid loading full datasets into memory.
- Hashing reads files in buffers; no full-file memory loads.
- Duplicate hashing uses multiprocessing where possible.
- Thread fallback keeps behavior functional in restricted/sandboxed environments.

## CLI Modes

- `analyze`
- `duplicates`
- `large`
- `old`
- `growth`
- `carbon`
- `dev-clean`
- `clean`
- `undo`
- `visualize`
- `forensics`

Global options:
- `--db`
- `--classifier-rules`
- `--log-file`

## Example Usage

### Full analysis
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  analyze \
  --roots /home/user \
  --top-n 100 \
  --output /tmp/analyze_report.json
```

### Duplicate detection (new scan)
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  duplicates --scan --roots /home/user/projects \
  --output /tmp/duplicates_report.json
```

### Large + old candidates
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  clean \
  --scan --roots /home/user \
  --mode large-old --min-size 1GB --days 180 --limit 2000 \
  --output /tmp/cleanup_dry_run.json
```

### Execute cleanup with quarantine
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  clean \
  --roots /home/user \
  --snapshot-id 12 \
  --mode duplicates \
  --execute --confirm --yes \
  --output /tmp/cleanup_execute.json
```

### Undo cleanup action
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  undo --action-id 20260217_230725_af3a9dd2 --yes \
  --output /tmp/undo_report.json
```

### Forensics (read-only)
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  forensics --roots /home/user --top-n 200 \
  --output /tmp/forensics_report.json
```

### Visual exports
```bash
python3 python_scripts/disk_intelligence_engine.py \
  --db /tmp/disk_intel.db \
  visualize --snapshot-id 12 --include-duplicates \
  --output-dir /tmp/disk_visuals \
  --output /tmp/visualize_report.json
```

## JSON Report Skeleton (Analyze)

```json
{
  "mode": "analyze",
  "generated_at": "2026-02-17T17:36:35+00:00",
  "summary": {
    "snapshot_id": 1,
    "total_files": 123456,
    "total_bytes": 9876543210,
    "roots": ["/home/user"]
  },
  "largest_files": [],
  "folder_sizes": [],
  "type_distribution": [],
  "extension_frequency": [],
  "pareto": {},
  "size_histogram": {},
  "growth": {},
  "growth_prediction": {},
  "carbon_estimation": {},
  "duplicates": {},
  "scan": {}
}
```

## Notes

- Linux-focused toolchain; package manager/dev-cache insights target common Linux workflows.
- CO₂ outputs are explicitly approximate.
- For 100k+ files, prefer snapshot-based repeated analysis (scan once, analyze multiple times by snapshot ID).
