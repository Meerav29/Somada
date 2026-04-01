import json
import os
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).parent.parent
VERTEX_API_BASE = "https://aiplatform.googleapis.com/v1"
DEFAULT_VERTEX_MODEL = "gemini-2.5-flash"
RETIRED_VERTEX_MODEL_UPGRADES = {
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-001": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite-001": "gemini-2.5-flash-lite",
}
MONTH_PATTERNS = [
    ("january", 1), ("jan", 1),
    ("february", 2), ("feb", 2),
    ("march", 3), ("mar", 3),
    ("april", 4), ("apr", 4),
    ("may", 5),
    ("june", 6), ("jun", 6),
    ("july", 7), ("jul", 7),
    ("august", 8), ("aug", 8),
    ("september", 9), ("sep", 9), ("sept", 9),
    ("october", 10), ("oct", 10),
    ("november", 11), ("nov", 11),
    ("december", 12), ("dec", 12),
]
EVENT_WORDS_TO_IGNORE = {"week", "semester"}


def get_vertex_model():
    configured = os.environ.get("VERTEX_MODEL", DEFAULT_VERTEX_MODEL).strip() or DEFAULT_VERTEX_MODEL
    return RETIRED_VERTEX_MODEL_UPGRADES.get(configured, configured)


def fetch_supabase_health_data():
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not supabase_url or not supabase_anon_key:
        return None
    if "your-supabase" in supabase_url or "your_supabase" in supabase_anon_key.lower():
        return None

    urls = [
        f"{supabase_url}/rest/v1/health_data?select=data&id=eq.1",
        f"{supabase_url}/rest/v1/health_data?select=data&limit=1",
    ]
    headers = {
        "apikey": supabase_anon_key,
        "Authorization": f"Bearer {supabase_anon_key}",
    }

    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=3) as resp:
                rows = json.loads(resp.read())
                if rows:
                    return rows[0].get("data")
        except Exception:
            continue
    return None


def load_health_data(local_path=None):
    data = fetch_supabase_health_data()
    if data is not None:
        return data

    health_file = pathlib.Path(local_path) if local_path else ROOT / "health_data.json"
    if not health_file.exists():
        return None

    with open(health_file) as f:
        return json.load(f)


def extract_vertex_text(data):
    for candidate in data.get("candidates", []):
        parts = ((candidate.get("content") or {}).get("parts") or [])
        text = "".join(part.get("text", "") for part in parts if part.get("text")).strip()
        finish_reason = candidate.get("finishReason") or candidate.get("finish_reason")

        if text:
            if finish_reason == "MAX_TOKENS":
                return f"{text}\n\n[Response stopped because it hit the model token limit.]"
            return text

        if finish_reason == "SAFETY":
            return "Vertex AI blocked the response for safety reasons."

    prompt_feedback = data.get("promptFeedback") or data.get("prompt_feedback") or {}
    block_reason = prompt_feedback.get("blockReason") or prompt_feedback.get("block_reason")
    if block_reason:
        return f"Vertex AI blocked this prompt ({block_reason})."

    return "Vertex AI returned an empty response."


def normalize_history(history, latest_message):
    latest_message = (latest_message or "").strip()
    cleaned = []

    for item in history or []:
        content = (item.get("content") or "").strip()
        if not content:
            continue
        role = "assistant" if item.get("role") == "assistant" else "user"
        cleaned.append({"role": role, "content": content})

    if cleaned and cleaned[-1]["role"] == "user" and cleaned[-1]["content"] == latest_message:
        cleaned = cleaned[:-1]

    return cleaned[-10:]


def parse_iso_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except Exception:
        return None


def format_number(value, digits=1):
    if value is None:
        return "N/A"
    if digits == 0:
        return f"{round(float(value)):,}"
    rounded = round(float(value), digits)
    if digits > 0 and abs(rounded - round(rounded)) < 1e-9:
        return f"{rounded:,.0f}"
    return f"{rounded:,.{digits}f}"


def average(values, digits=1):
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return None
    return round(sum(clean) / len(clean), digits)


def build_daily_list(health_data):
    daily = health_data.get("daily", {}) or {}
    rows = [dict(day) for day in daily.values() if day.get("date")]
    rows.sort(key=lambda row: row["date"])
    return rows


def with_recovery_scores(daily_list):
    hrv_values = [day.get("hrv") for day in daily_list if day.get("hrv") is not None]
    rhr_values = [day.get("resting_hr") for day in daily_list if day.get("resting_hr") is not None]
    min_hrv = min(hrv_values) if hrv_values else None
    max_hrv = max(hrv_values) if hrv_values else None
    min_rhr = min(rhr_values) if rhr_values else None
    max_rhr = max(rhr_values) if rhr_values else None

    enriched = []
    for day in daily_list:
        row = dict(day)
        row["recovery_score"] = None
        hrv = row.get("hrv")
        resting_hr = row.get("resting_hr")
        if hrv is not None and resting_hr is not None:
            norm_hrv = 50 if min_hrv == max_hrv else ((hrv - min_hrv) / (max_hrv - min_hrv)) * 100
            norm_rhr = 50 if min_rhr == max_rhr else ((max_rhr - resting_hr) / (max_rhr - min_rhr)) * 100
            row["recovery_score"] = round(norm_hrv * 0.6 + norm_rhr * 0.4, 1)
        enriched.append(row)
    return enriched


def build_monthly_rollups(daily_list):
    buckets = {}
    for day in daily_list:
        month_key = day["date"][:7]
        bucket = buckets.setdefault(month_key, {
            "dates": [],
            "steps": [],
            "sleep_hours": [],
            "resting_hr": [],
            "hrv": [],
            "recovery_score": [],
        })
        bucket["dates"].append(day["date"])
        for key in ("steps", "sleep_hours", "resting_hr", "hrv", "recovery_score"):
            if day.get(key) is not None:
                bucket[key].append(day[key])

    rows = []
    for month_key in sorted(buckets):
        bucket = buckets[month_key]
        month_date = parse_iso_date(f"{month_key}-01")
        rows.append({
            "month_key": month_key,
            "month_label": month_date.strftime("%b %Y") if month_date else month_key,
            "days": len(bucket["dates"]),
            "avg_steps": average(bucket["steps"], 0),
            "avg_sleep_hours": average(bucket["sleep_hours"], 1),
            "avg_resting_hr": average(bucket["resting_hr"], 1),
            "avg_hrv": average(bucket["hrv"], 1),
            "avg_recovery": average(bucket["recovery_score"], 1),
        })
    return rows


def format_monthly_table(monthly_rows):
    if not monthly_rows:
        return "No monthly rollups available."

    lines = [
        "Month | Days | Recovery | Sleep(h) | Resting HR | HRV | Steps",
        "-" * 74,
    ]
    for row in monthly_rows:
        lines.append(
            f"{row['month_label']} | "
            f"{row['days']} | "
            f"{format_number(row['avg_recovery'], 1)} | "
            f"{format_number(row['avg_sleep_hours'], 1)} | "
            f"{format_number(row['avg_resting_hr'], 1)} | "
            f"{format_number(row['avg_hrv'], 1)} | "
            f"{format_number(row['avg_steps'], 0)}"
        )
    return "\n".join(lines)


def best_month_line(monthly_rows, key, label, higher_is_better=True, digits=1, suffix=""):
    eligible = [row for row in monthly_rows if row.get(key) is not None]
    if not eligible:
        return f"- {label}: N/A"
    chooser = max if higher_is_better else min
    best = chooser(eligible, key=lambda row: row[key])
    value = format_number(best[key], digits)
    return f"- {label}: {best['month_label']} ({value}{suffix})"


def in_date_range(day, start, end):
    return start <= day.get("date", "") <= end


def build_event_summaries(daily_list, events):
    if not events:
        return [], []

    event_rows = []
    missing = []
    for event in events:
        start = event.get("start")
        end = event.get("end")
        label = event.get("label", "Event")
        if not start or not end:
            continue

        rows = [day for day in daily_list if in_date_range(day, start, end)]
        if not rows:
            missing.append(f"{label} ({start} to {end})")
            continue

        baseline_end = parse_iso_date(start)
        baseline_rows = []
        if baseline_end:
            baseline_start = (baseline_end - timedelta(days=14)).strftime("%Y-%m-%d")
            baseline_finish = (baseline_end - timedelta(days=1)).strftime("%Y-%m-%d")
            baseline_rows = [day for day in daily_list if in_date_range(day, baseline_start, baseline_finish)]

        compare_rows = baseline_rows or daily_list
        event_sleep = average([day.get("sleep_hours") for day in rows], 1)
        event_steps = average([day.get("steps") for day in rows], 0)
        event_recovery = average([day.get("recovery_score") for day in rows], 1)
        baseline_sleep = average([day.get("sleep_hours") for day in compare_rows], 1)
        baseline_steps = average([day.get("steps") for day in compare_rows], 0)
        baseline_recovery = average([day.get("recovery_score") for day in compare_rows], 1)

        event_rows.append({
            "label": label,
            "start": start,
            "end": end,
            "days": len(rows),
            "sleep": event_sleep,
            "sleep_delta": round(event_sleep - baseline_sleep, 1) if event_sleep is not None and baseline_sleep is not None else None,
            "steps": event_steps,
            "steps_delta": round(event_steps - baseline_steps, 0) if event_steps is not None and baseline_steps is not None else None,
            "recovery": event_recovery,
            "recovery_delta": round(event_recovery - baseline_recovery, 1) if event_recovery is not None and baseline_recovery is not None else None,
            "baseline_label": "prior 14d" if baseline_rows else "overall",
        })
    return event_rows, missing


def signed_number(value, digits=1):
    if value is None:
        return "N/A"
    sign = "+" if value > 0 else ""
    return f"{sign}{format_number(value, digits)}"


def format_event_table(event_rows):
    if not event_rows:
        return "No event windows overlap the stored data."

    lines = [
        "Event | Dates | Days | Sleep(h) | Steps | Recovery | Comparison baseline",
        "-" * 88,
    ]
    for row in event_rows:
        sleep_text = format_number(row["sleep"], 1)
        if row["sleep_delta"] is not None:
            sleep_text += f" ({signed_number(row['sleep_delta'], 1)})"

        steps_text = format_number(row["steps"], 0)
        if row["steps_delta"] is not None:
            steps_text += f" ({signed_number(row['steps_delta'], 0)})"

        recovery_text = format_number(row["recovery"], 1)
        if row["recovery_delta"] is not None:
            recovery_text += f" ({signed_number(row['recovery_delta'], 1)})"

        lines.append(
            f"{row['label']} | "
            f"{row['start']} to {row['end']} | "
            f"{row['days']} | "
            f"{sleep_text} | "
            f"{steps_text} | "
            f"{recovery_text} | "
            f"{row['baseline_label']}"
        )
    return "\n".join(lines)


def match_events(message, events):
    lower = message.lower()
    matches = []
    for event in events or []:
        label = event.get("label", "")
        label_words = [
            word for word in re.findall(r"[a-z]+", label.lower())
            if len(word) > 2 and word not in EVENT_WORDS_TO_IGNORE
        ]
        if any(word in lower for word in label_words):
            matches.append(event)
            continue
        if "final" in lower and "final" in label.lower():
            matches.append(event)
            continue
        if "break" in lower and "break" in label.lower():
            matches.append(event)
            continue
    return matches


def month_bounds(month_key):
    start = parse_iso_date(f"{month_key}-01")
    if not start:
        return None, None
    if start.month == 12:
        next_month = start.replace(year=start.year + 1, month=1)
    else:
        next_month = start.replace(month=start.month + 1)
    end = next_month - timedelta(days=1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def match_month_keys(message, daily_list):
    lower = message.lower()
    years = {int(year) for year in re.findall(r"\b(20\d{2})\b", message)}
    available_months = sorted({day["date"][:7] for day in daily_list})
    matches = set()

    for pattern, month_number in MONTH_PATTERNS:
        if not re.search(rf"\b{pattern}\b", lower):
            continue
        for month_key in available_months:
            year = int(month_key[:4])
            month = int(month_key[5:7])
            if month != month_number:
                continue
            if years and year not in years:
                continue
            matches.add(month_key)
    return sorted(matches)


def select_relevant_days(daily_list, events, query_text):
    matched_ranges = []
    labels = []

    for event in match_events(query_text, events):
        start = event.get("start")
        end = event.get("end")
        if not start or not end:
            continue
        matched_ranges.append((start, end))
        labels.append(event.get("label", "Event"))

    for month_key in match_month_keys(query_text, daily_list):
        start, end = month_bounds(month_key)
        if start and end:
            matched_ranges.append((start, end))
            month_date = parse_iso_date(f"{month_key}-01")
            labels.append(month_date.strftime("%b %Y") if month_date else month_key)

    for exact_date in re.findall(r"\b20\d{2}-\d{2}-\d{2}\b", query_text):
        matched_ranges.append((exact_date, exact_date))
        labels.append(exact_date)

    if not matched_ranges:
        return daily_list[-21:], "Recent 21 days"

    selected = []
    seen_dates = set()
    for start, end in matched_ranges:
        rows = [day for day in daily_list if start <= day["date"] <= end]
        if len(rows) > 18:
            rows = rows[:9] + rows[-9:]
        for row in rows:
            if row["date"] in seen_dates:
                continue
            selected.append(row)
            seen_dates.add(row["date"])

    selected.sort(key=lambda row: row["date"])
    if not selected:
        return daily_list[-21:], "Recent 21 days"

    label = ", ".join(dict.fromkeys(labels))
    return selected[:42], label


def format_daily_table(rows):
    if not rows:
        return "No relevant daily rows found."

    lines = [
        "Date | Steps | Sleep(h) | Resting HR | HRV | Recovery",
        "-" * 66,
    ]
    for day in rows:
        lines.append(
            f"{day['date']} | "
            f"{format_number(day.get('steps'), 0)} | "
            f"{format_number(day.get('sleep_hours'), 1)} | "
            f"{format_number(day.get('resting_hr'), 1)} | "
            f"{format_number(day.get('hrv'), 1)} | "
            f"{format_number(day.get('recovery_score'), 1)}"
        )
    return "\n".join(lines)


def build_system_prompt(health_data, user_message="", events=None):
    if events is None:
        events = health_data.get("events", [])

    summary = health_data.get("summary", {}) or {}
    generated_at = health_data.get("generated_at", "unknown")
    daily_list = with_recovery_scores(build_daily_list(health_data))
    if not daily_list:
        return (
            "You are an AI health analyst. No daily health data is available, so explain that "
            "the upload or parsing step needs to be rerun before answering."
        )

    coverage_start = daily_list[0]["date"]
    coverage_end = daily_list[-1]["date"]
    monthly_rows = build_monthly_rollups(daily_list)
    event_rows, missing_events = build_event_summaries(daily_list, events)
    relevant_rows, relevant_label = select_relevant_days(daily_list, events, user_message)
    recent_rows = daily_list[-14:]

    prompt_lines = [
        "You are Somada's AI health analyst for Meerav Shah, a Penn State college student.",
        "Base answers on the uploaded data below, not on generic expectations.",
        "If the requested time period is outside the available coverage, say that explicitly and cite the exact coverage dates.",
        "If relevant rows are present below, do not say the data is missing.",
        "Use complete sentences and finish the answer cleanly.",
        "",
        "DATA COVERAGE:",
        f"- Daily data available from {coverage_start} to {coverage_end}",
        f"- Health data snapshot generated at: {generated_at}",
        f"- Total stored days: {summary.get('total_days', len(daily_list))}",
        "",
        "OVERALL SUMMARY:",
        f"- Average steps/day: {format_number(summary.get('avg_steps'), 0)}",
        f"- Average sleep: {format_number(summary.get('avg_sleep_hours'), 1)} hours",
        f"- Average resting HR: {format_number(summary.get('avg_resting_hr'), 1)} bpm",
        f"- Average HRV: {format_number(summary.get('avg_hrv'), 1)} ms",
        "",
        "KEY MONTHLY HIGHLIGHTS:",
        best_month_line(monthly_rows, "avg_recovery", "Best recovery month", True, 1),
        best_month_line(monthly_rows, "avg_sleep_hours", "Best sleep month", True, 1, "h"),
        best_month_line(monthly_rows, "avg_hrv", "Highest HRV month", True, 1, " ms"),
        best_month_line(monthly_rows, "avg_resting_hr", "Lowest resting-HR month", False, 1, " bpm"),
        "",
        "MONTHLY ROLLUPS:",
        format_monthly_table(monthly_rows),
        "",
        "EVENT SUMMARIES:",
        format_event_table(event_rows),
    ]

    if missing_events:
        prompt_lines.extend([
            "",
            "EVENTS OUTSIDE CURRENT DATA COVERAGE:",
            *[f"- {item}" for item in missing_events],
        ])

    prompt_lines.extend([
        "",
        f"RELEVANT DAILY ROWS FOR THIS QUESTION ({relevant_label}):",
        format_daily_table(relevant_rows),
        "",
        "RECENT 14 DAYS:",
        format_daily_table(recent_rows),
        "",
        "ANALYSIS RULES:",
        "- For 'best recovery month' questions, use the MONTHLY ROLLUPS recovery column first.",
        "- Recovery score in this prompt is a derived 0-100 blend: HRV 60% and resting HR 40% (lower resting HR is better).",
        "- For finals, breaks, or other event questions, use the EVENT SUMMARIES table and the relevant daily rows before making any claim.",
        "- Mention exact dates and numbers when available.",
        "- If data is mixed or limited, say what is known and what is not.",
    ])

    return "\n".join(prompt_lines)


def chat_with_vertex(message, history, health_data, api_key, model):
    if not api_key:
        return "Error: VERTEX_API_KEY not set."

    history = normalize_history(history, message)
    query_context = "\n".join(
        [item["content"] for item in history if item.get("role") == "user"][-3:] + [message]
    )
    system_prompt = build_system_prompt(health_data, user_message=query_context)

    contents = []
    for item in history:
        role = "model" if item["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": item["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 1536,
            "temperature": 0.2,
        },
    }

    model_path = f"publishers/google/models/{urllib.parse.quote(model, safe='')}:generateContent"
    url = f"{VERTEX_API_BASE}/{model_path}?{urllib.parse.urlencode({'key': api_key})}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            return extract_vertex_text(json.loads(resp.read()))
    except urllib.error.HTTPError as e:
        return f"API Error {e.code}: {e.read().decode()}"
    except Exception as e:
        return f"Error: {str(e)}"
