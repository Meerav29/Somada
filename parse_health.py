"""
Apple Health XML Parser
Converts export.xml to daily aggregates for the dashboard.
Usage: python parse_health.py path/to/export.xml
"""

import xml.etree.ElementTree as ET
import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict

# Life events to annotate - edit dates to match your actual life
LIFE_EVENTS = [
    {"label": "Finals Week", "start": "2024-12-09", "end": "2024-12-15", "color": "#ef4444", "icon": "📚"},
    {"label": "Winter Break", "start": "2024-12-16", "end": "2025-01-05", "color": "#22c55e", "icon": "🏖️"},
    {"label": "Spring Break", "start": "2025-03-08", "end": "2025-03-16", "color": "#22c55e", "icon": "✈️"},
    {"label": "Finals Week", "start": "2025-04-28", "end": "2025-05-05", "color": "#ef4444", "icon": "📚"},
    {"label": "Summer Break", "start": "2025-05-10", "end": "2025-08-20", "color": "#f59e0b", "icon": "☀️"},
    {"label": "Fall Semester", "start": "2025-08-25", "end": "2025-12-15", "color": "#8b5cf6", "icon": "🎓"},
    {"label": "Finals Week", "start": "2025-12-08", "end": "2025-12-14", "color": "#ef4444", "icon": "📚"},
    {"label": "Winter Break", "start": "2025-12-15", "end": "2026-01-10", "color": "#22c55e", "icon": "🏖️"},
    {"label": "Spring Semester", "start": "2026-01-12", "end": "2026-02-24", "color": "#8b5cf6", "icon": "🎓"},
]

METRIC_MAP = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierHeartRate": "heart_rate",
    "HKQuantityTypeIdentifierRestingHeartRate": "resting_heart_rate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv",
    "HKCategoryTypeIdentifierSleepAnalysis": "sleep",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_calories",
    "HKQuantityTypeIdentifierAppleExerciseTime": "exercise_minutes",
    "HKQuantityTypeIdentifierOxygenSaturation": "spo2",
    "HKQuantityTypeIdentifierRespiratoryRate": "respiratory_rate",
    # Amazfit/Zepp specific
    "HKQuantityTypeIdentifierWalkingHeartRateAverage": "walking_hr",
}

SLEEP_VALUES = {
    "HKCategoryValueSleepAnalysisAsleep": "asleep",
    "HKCategoryValueSleepAnalysisInBed": "in_bed",
    "HKCategoryValueSleepAnalysisAwake": "awake",
    "HKCategoryValueSleepAnalysisCore": "asleep",
    "HKCategoryValueSleepAnalysisDeep": "asleep",
    "HKCategoryValueSleepAnalysisREM": "asleep",
}

def parse_date(date_str):
    """Parse Apple Health date format."""
    for fmt in ["%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S"]:
        try:
            return datetime.strptime(date_str[:19], fmt[:len(fmt)-3] if '%z' in fmt else fmt)
        except:
            pass
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except:
        return None

def parse_health_xml(xml_path):
    print(f"Parsing {xml_path}...")
    print("This may take a minute for large files...")

    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
    except ET.ParseError as e:
        print(f"Error parsing XML: {e}")
        sys.exit(1)

    daily = defaultdict(lambda: {
        "steps": [],
        "heart_rate": [],
        "resting_heart_rate": [],
        "hrv": [],
        "sleep_minutes": 0,
        "active_calories": [],
        "exercise_minutes": [],
        "spo2": [],
        "respiratory_rate": [],
    })

    record_count = 0
    for record in root.findall(".//Record"):
        record_type = record.get("type", "")
        metric = METRIC_MAP.get(record_type)
        if not metric:
            continue

        start_date = parse_date(record.get("startDate", ""))
        if not start_date:
            continue

        date_key = start_date.strftime("%Y-%m-%d")
        value_str = record.get("value", "")

        if metric == "sleep":
            sleep_val = record.get("value", "")
            sleep_type = SLEEP_VALUES.get(sleep_val)
            if sleep_type == "asleep":
                end_date = parse_date(record.get("endDate", ""))
                if end_date:
                    duration_mins = (end_date - start_date).total_seconds() / 60
                    if 0 < duration_mins < 720:  # sanity check: < 12 hours
                        daily[date_key]["sleep_minutes"] += duration_mins
        else:
            try:
                value = float(value_str)
                if metric in daily[date_key] and isinstance(daily[date_key][metric], list):
                    daily[date_key][metric].append(value)
            except (ValueError, TypeError):
                pass

        record_count += 1
        if record_count % 50000 == 0:
            print(f"  Processed {record_count:,} records...")

    print(f"  Total records processed: {record_count:,}")
    print(f"  Days with data: {len(daily)}")

    # Aggregate daily values
    aggregated = {}
    for date_key, data in sorted(daily.items()):
        agg = {"date": date_key}

        agg["steps"] = int(sum(data["steps"])) if data["steps"] else None
        agg["heart_rate_avg"] = round(sum(data["heart_rate"]) / len(data["heart_rate"]), 1) if data["heart_rate"] else None
        agg["heart_rate_min"] = round(min(data["heart_rate"]), 1) if data["heart_rate"] else None
        agg["heart_rate_max"] = round(max(data["heart_rate"]), 1) if data["heart_rate"] else None
        agg["resting_hr"] = round(sum(data["resting_heart_rate"]) / len(data["resting_heart_rate"]), 1) if data["resting_heart_rate"] else None
        agg["hrv"] = round(sum(data["hrv"]) / len(data["hrv"]), 1) if data["hrv"] else None
        agg["sleep_hours"] = round(data["sleep_minutes"] / 60, 2) if data["sleep_minutes"] > 0 else None
        agg["active_calories"] = round(sum(data["active_calories"]), 0) if data["active_calories"] else None
        agg["exercise_minutes"] = round(sum(data["exercise_minutes"]), 0) if data["exercise_minutes"] else None
        agg["spo2"] = round(sum(data["spo2"]) / len(data["spo2"]), 1) if data["spo2"] else None

        aggregated[date_key] = agg

    return aggregated

def get_date_range_last_n_months(data, months=6):
    """Filter to last N months of data."""
    cutoff = datetime.now() - timedelta(days=months * 30)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    return {k: v for k, v in data.items() if k >= cutoff_str}

def compute_summary_stats(data):
    """Compute overall stats for the AI context."""
    all_days = list(data.values())

    def avg(vals):
        clean = [v for v in vals if v is not None]
        return round(sum(clean) / len(clean), 1) if clean else None

    def best(vals):
        clean = [v for v in vals if v is not None]
        return max(clean) if clean else None

    def worst(vals):
        clean = [v for v in vals if v is not None]
        return min(clean) if clean else None

    return {
        "avg_steps": avg([d.get("steps") for d in all_days]),
        "avg_sleep_hours": avg([d.get("sleep_hours") for d in all_days]),
        "avg_resting_hr": avg([d.get("resting_hr") for d in all_days]),
        "avg_hrv": avg([d.get("hrv") for d in all_days]),
        "best_sleep": best([d.get("sleep_hours") for d in all_days]),
        "worst_sleep": worst([d.get("sleep_hours") for d in all_days]),
        "best_steps_day": max(all_days, key=lambda d: d.get("steps") or 0).get("date") if all_days else None,
        "total_days": len(all_days),
    }

def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_health.py path/to/export.xml")
        print("\nTo export from Apple Health:")
        print("  Health app → Profile picture → Export All Health Data")
        sys.exit(1)

    xml_path = sys.argv[1]
    data = parse_health_xml(xml_path)

    # Filter to last 8 months for good coverage
    filtered = get_date_range_last_n_months(data, months=8)

    summary = compute_summary_stats(filtered)

    output = {
        "daily": filtered,
        "summary": summary,
        "events": LIFE_EVENTS,
        "generated_at": datetime.now().isoformat(),
    }

    output_path = "health_data.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ Done! Saved to {output_path}")
    print(f"\n📊 Quick stats:")
    print(f"   Days of data: {summary['total_days']}")
    print(f"   Avg steps/day: {summary['avg_steps']:,}" if summary['avg_steps'] else "   Avg steps: N/A")
    print(f"   Avg sleep: {summary['avg_sleep_hours']}h" if summary['avg_sleep_hours'] else "   Avg sleep: N/A")
    print(f"   Avg resting HR: {summary['avg_resting_hr']} bpm" if summary['avg_resting_hr'] else "   Avg resting HR: N/A")
    print(f"   Avg HRV: {summary['avg_hrv']} ms" if summary['avg_hrv'] else "   Avg HRV: N/A")
    print(f"\nNow run: python server.py")

if __name__ == "__main__":
    main()
