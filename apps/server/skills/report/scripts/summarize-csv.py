#!/usr/bin/env python3
"""Aggregate an explicit UTF-8 CSV export without dependencies or network access."""
import argparse
import csv
import json
from decimal import Decimal, InvalidOperation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file")
    parser.add_argument("--group", required=True, help="CSV column header")
    parser.add_argument("--metric", choices=("count", "sum", "average"), default="count")
    parser.add_argument("--value", help="Numeric CSV column header")
    args = parser.parse_args()
    if args.metric != "count" and not args.value:
        parser.error("--value is required for sum and average")
    groups = {}
    with open(args.csv_file, encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {args.group} | ({args.value} if args.value else set())
        if not required.issubset(reader.fieldnames or []):
            parser.error("CSV is missing required column headers")
        for line, row in enumerate(reader, start=2):
            key = row[args.group] or ""
            group = groups.setdefault(key, {"rows": 0, "numbers": 0, "sum": Decimal(0)})
            group["rows"] += 1
            if args.metric != "count" and row[args.value].strip():
                try:
                    value = Decimal(row[args.value].strip())
                    if not value.is_finite():
                        raise InvalidOperation
                except InvalidOperation:
                    parser.error(f"Invalid numeric value at CSV line {line}")
                group["numbers"] += 1
                group["sum"] += value
    result = []
    for key, group in sorted(groups.items()):
        value = group["rows"] if args.metric == "count" else (
            None if group["numbers"] == 0 else
            float(group["sum"] / group["numbers"] if args.metric == "average" else group["sum"])
        )
        result.append({"group": key, "value": value, "rows": group["rows"]})
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
